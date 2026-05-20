// PostHog + Sentry telemetry for the MCP server. ON by default in
// published builds (keys baked in via telemetry-constants.ts), OFF via
// LEADBAY_TELEMETRY_DISABLED=1 or NODE_ENV=test. See packages/mcp/README.md
// for the public contract.
//
// Two stdio safety constraints drive the shape here:
//
// 1. NEVER write to stdout — that's the JSON-RPC channel. PostHog and
//    Sentry both ship reasonable defaults (no console.log spam), and we
//    explicitly disable Sentry's default integrations (which include
//    console capture that would tee error logs to stderr — fine in
//    principle but we keep the stderr-noise budget for our own logger).
//
// 2. PostHog `distinctId` MUST be `me.email` so MCP events consolidate
//    with the frontend in PostHog (the user requirement). Identity is
//    fired non-blocking after the client is constructed; events captured
//    before identity resolves are BUFFERED in-memory and flushed with the
//    resolved email once `/users/me` lands. This keeps server boot
//    instant while still satisfying the email-distinctId requirement.

import { PostHog } from "posthog-node";
import * as Sentry from "@sentry/node";
import type { LeadbayClient, ToolLogger, UserMePayload } from "@leadbay/core";
import {
  EMBEDDED_POSTHOG_HOST,
  EMBEDDED_POSTHOG_KEY,
  EMBEDDED_SENTRY_DSN,
} from "./telemetry-constants.js";
import {
  EV_MCP_UPDATE_CHECK,
  EV_MCP_UPDATE_DISMISSED,
  EV_MCP_UPDATE_INSTALL_CLICKED,
  EV_MCP_UPDATE_PROMPTED,
  EV_MCP_VERSION_UPDATED,
  EV_QUOTA_HIT,
  EV_STARTUP,
  EV_TOOL_CALL,
  EV_TOPUP_LINK,
  type ExceptionCtx,
  type QuotaHitProps,
  type StartupProps,
  type ToolCallProps,
  type TopupLinkProps,
  type UpdateCheckProps,
  type UpdateDismissedProps,
  type UpdateInstallClickedProps,
  type UpdatePromptedProps,
  type VersionUpdatedProps,
} from "./telemetry-events.js";

export interface TelemetryHandle {
  // Returns a promise that resolves once identity settles (either /users/me
  // landed and we identified, or it failed and we fell back to anonymous).
  // Production callers (bin.ts) fire-and-forget; tests await the promise
  // to make capture assertions deterministic.
  identify(client: LeadbayClient): Promise<void>;
  captureToolCall(props: ToolCallProps): void;
  captureQuotaHit(props: QuotaHitProps): void;
  captureTopupLink(props: TopupLinkProps): void;
  captureStartup(props: StartupProps): void;
  captureException(err: unknown, ctx: ExceptionCtx): void;
  // Auto-update lifecycle. Optional on the interface so out-of-tree
  // TelemetryHandle implementations don't have to implement them; the
  // update-check site null-checks before calling. NOOP_TELEMETRY +
  // the real PostHog impl both provide them.
  captureUpdateCheck?(props: UpdateCheckProps): void;
  captureUpdatePrompted?(props: UpdatePromptedProps): void;
  captureUpdateInstallClicked?(props: UpdateInstallClickedProps): void;
  captureUpdateDismissed?(props: UpdateDismissedProps): void;
  captureVersionUpdated?(props: VersionUpdatedProps): void;
  shutdown(): Promise<void>;
}

export const NOOP_TELEMETRY: TelemetryHandle = {
  identify: async () => {},
  captureToolCall: () => {},
  captureQuotaHit: () => {},
  captureTopupLink: () => {},
  captureStartup: () => {},
  captureException: () => {},
  captureUpdateCheck: () => {},
  captureUpdatePrompted: () => {},
  captureUpdateInstallClicked: () => {},
  captureUpdateDismissed: () => {},
  captureVersionUpdated: () => {},
  shutdown: async () => {},
};

interface InitOpts {
  version: string;
  logger?: ToolLogger;
}

interface BufferedEvent {
  event: string;
  properties: Record<string, unknown>;
}

// Boolean parser for LEADBAY_TELEMETRY_ENABLED. Positive polarity (enabled),
// not the older DISABLED=1 negative polarity, because MCP-client config UIs
// render env-var booleans as toggles — "Enabled = on" reads sensibly; the
// double-negative "Disabled = on means off" does not.
//
// Default ON when unset for back-compat: existing installs written before
// this env var existed should continue phoning home (telemetry was already
// ON by default in those builds via the baked-in keys + no opt-out var).
//
// Recognized:  unset/empty -> true (default ON)
//              true|1|yes|on -> true
//              false|0|no|off -> false
//              anything else -> true (fail-open to ON, like LEADBAY_MCP_WRITE)
export function parseTelemetryEnv(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return true;
}

export function initTelemetry(opts: InitOpts): TelemetryHandle {
  // Hard opt-outs.
  if (!parseTelemetryEnv(process.env.LEADBAY_TELEMETRY_ENABLED)) return NOOP_TELEMETRY;
  if (process.env.NODE_ENV === "test") return NOOP_TELEMETRY;

  const posthogKey = process.env.LEADBAY_POSTHOG_KEY ?? EMBEDDED_POSTHOG_KEY;
  const sentryDsn = process.env.LEADBAY_SENTRY_DSN ?? EMBEDDED_SENTRY_DSN;
  if (!posthogKey && !sentryDsn) return NOOP_TELEMETRY;

  const { version, logger } = opts;
  const environment =
    process.env.LEADBAY_ENV ??
    (version.includes("-dev.") ? "dev" : "production");

  let posthog: PostHog | null = null;
  let sentryReady = false;
  let initError: Error | null = null;

  try {
    if (posthogKey) {
      posthog = new PostHog(posthogKey, {
        host: process.env.LEADBAY_POSTHOG_HOST ?? EMBEDDED_POSTHOG_HOST,
        flushAt: 20,
        flushInterval: 10_000,
        disableGeoip: false,
      });
    }
  } catch (err: any) {
    initError = err;
    posthog = null;
  }

  try {
    if (sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        release: `@leadbay/mcp@${version}`,
        environment,
        tracesSampleRate: 0,
        profilesSampleRate: 0,
        defaultIntegrations: false,
        integrations: [Sentry.httpIntegration()],
        sendDefaultPii: false,
        // Tag every captured event with the surface so Sentry views can
        // split MCP issues from web-app issues without per-call work.
        initialScope: {
          tags: { source: "mcp" },
        },
      });
      sentryReady = true;
    }
  } catch (err: any) {
    initError = initError ?? err;
    sentryReady = false;
  }

  if (initError) {
    logger?.warn?.(`telemetry init failed: ${initError.message ?? initError}`);
  }
  if (!posthog && !sentryReady) return NOOP_TELEMETRY;

  // Identity state. resolveMe() is fired non-blocking; events captured
  // before it resolves go into pendingEvents and flush on resolution.
  let me: UserMePayload | null = null;
  let identityPromise: Promise<void> | null = null;
  const pendingEvents: BufferedEvent[] = [];
  // Region is on the LeadbayClient, not on /users/me. We capture it when
  // identify(client) is called so every event can be tagged with it.
  let region: string = "unknown";

  const baseProps = (): Record<string, unknown> => ({
    // Always tag MCP-originated events so PostHog dashboards can split
    // MCP usage from the web app and any future surfaces. The value
    // ("mcp") is the canonical source identifier — match it in any
    // PostHog filter or insight that should isolate the MCP surface.
    source: "mcp",
    mcp_version: version,
    node_version: process.versions.node,
    platform: process.platform,
    region,
  });

  const distinctIdFor = (): string => {
    // Email is the canonical distinctId so MCP events consolidate with the
    // frontend in PostHog. Fall back to user id if email is missing, then
    // to an anonymous sentinel (only seen if identity resolution itself
    // failed — pending events flush will use this).
    if (me?.email) return me.email;
    if (me?.id) return `mcp:user-${me.id}`;
    return "mcp:unknown";
  };

  const groupsFor = (): Record<string, string> | undefined => {
    return me?.organization?.id
      ? { organization: me.organization.id }
      : undefined;
  };

  const doCapture = (event: string, properties: Record<string, unknown>) => {
    if (!posthog) return;
    try {
      posthog.capture({
        distinctId: distinctIdFor(),
        event,
        properties: { ...baseProps(), ...properties },
        groups: groupsFor(),
      });
    } catch (err: any) {
      logger?.warn?.(`posthog capture failed: ${err?.message ?? err}`);
    }
  };

  const emit = (event: string, properties: Record<string, unknown>) => {
    if (!posthog) return;
    if (!me) {
      pendingEvents.push({ event, properties });
      return;
    }
    doCapture(event, properties);
  };

  const flushPending = () => {
    if (!posthog || pendingEvents.length === 0) return;
    const buf = pendingEvents.splice(0, pendingEvents.length);
    for (const { event, properties } of buf) {
      doCapture(event, properties);
    }
  };

  return {
    identify(client): Promise<void> {
      if (identityPromise) return identityPromise;
      region = client.region;
      identityPromise = (async () => {
        try {
          const resolved = await client.resolveMe();
          me = resolved;
          if (posthog && resolved.email) {
            try {
              posthog.identify({
                distinctId: resolved.email,
                properties: {
                  email: resolved.email,
                  leadbay_id: resolved.id,
                  leadbay_name: resolved.name,
                  leadbay_organization: resolved.organization?.name,
                  leadbay_organization_id: resolved.organization?.id,
                },
              });
            } catch (err: any) {
              logger?.warn?.(`posthog identify failed: ${err?.message ?? err}`);
            }
          }
          if (sentryReady) {
            try {
              Sentry.setUser({
                id: resolved.id,
                email: resolved.email,
                username: resolved.name,
              });
            } catch (err: any) {
              logger?.warn?.(`sentry setUser failed: ${err?.message ?? err}`);
            }
          }
          flushPending();
        } catch (err: any) {
          // /users/me failed — flush buffered events anonymously so we
          // don't hold them forever.
          logger?.warn?.(
            `telemetry identify failed (${err?.message ?? err}); flushing events anonymously`
          );
          me = {
            id: "unknown",
            organization: { id: "unknown", name: "unknown" },
          } as UserMePayload;
          flushPending();
        }
      })();
      return identityPromise;
    },
    captureToolCall(props) {
      emit(EV_TOOL_CALL, { ...props });
    },
    captureQuotaHit(props) {
      emit(EV_QUOTA_HIT, { ...props });
    },
    captureTopupLink(props) {
      emit(EV_TOPUP_LINK, { ...props });
    },
    captureStartup(props) {
      emit(EV_STARTUP, { ...props });
    },
    captureUpdateCheck(props) {
      emit(EV_MCP_UPDATE_CHECK, { ...props });
    },
    captureUpdatePrompted(props) {
      emit(EV_MCP_UPDATE_PROMPTED, { ...props });
    },
    captureUpdateInstallClicked(props) {
      emit(EV_MCP_UPDATE_INSTALL_CLICKED, { ...props });
    },
    captureUpdateDismissed(props) {
      emit(EV_MCP_UPDATE_DISMISSED, { ...props });
    },
    captureVersionUpdated(props) {
      emit(EV_MCP_VERSION_UPDATED, { ...props });
    },
    captureException(err, ctx) {
      if (!sentryReady) return;
      try {
        Sentry.withScope((scope) => {
          scope.setTag("tool", ctx.tool);
          if (me?.organization?.id) {
            scope.setTag("organization", me.organization.id);
          }
          Sentry.captureException(err);
        });
      } catch (e: any) {
        logger?.warn?.(`sentry captureException failed: ${e?.message ?? e}`);
      }
    },
    async shutdown() {
      // Bounded so a network hang can't block process exit.
      const tasks: Promise<unknown>[] = [];
      if (posthog) tasks.push(posthog.shutdown(2000).catch(() => undefined));
      if (sentryReady) tasks.push(Sentry.close(2000).catch(() => undefined));
      await Promise.allSettled(tasks);
    },
  };
}
