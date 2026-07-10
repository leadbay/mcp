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
  EV_COMPOSITE_CALL,
  EV_MCP_UPDATE_CHECK,
  EV_MCP_UPDATE_DISMISSED,
  EV_MCP_UPDATE_INSTALL_CLICKED,
  EV_MCP_UPDATE_PROMPTED,
  EV_MCP_VERSION_UPDATED,
  EV_QUOTA_HIT,
  EV_STARTUP,
  EV_TOOL_CALL,
  EV_TOPUP_LINK,
  EV_AGENT_MEMORY_CAPTURED,
  EV_AGENT_MEMORY_RECALLED,
  EV_AGENT_MEMORY_PRUNED,
  EV_FRICTION_REPORTED,
  type AgentMemoryCapturedProps,
  type AgentMemoryPrunedProps,
  type AgentMemoryRecalledProps,
  type CompositeCallProps,
  type ExceptionCtx,
  type FrictionReportedProps,
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

// Per-call identity override. The stdio server has ONE long-lived user, so it
// relies on the module-scoped `me` resolved once by identify(). The HTTP server
// (http-server.ts) is multi-tenant: each request carries its own bearer token →
// potentially a different user. It can't use the single-`me` model without
// latching the first caller's identity onto everyone. So the HTTP path resolves
// identity per request and passes it here, overriding distinctId/groups/region
// for THAT call only. When omitted (stdio), the module-scoped identity is used
// and behavior is unchanged.
export interface CaptureIdentity {
  // Canonical PostHog distinctId — the user's email when known, else an
  // `mcp:user-<id>` / `mcp:unknown` sentinel (mirrors distinctIdFor()).
  distinctId: string;
  // PostHog group analytics — `{ organization: <id> }` when known.
  groups?: Record<string, string>;
  // Region tag for baseProps (the module-scoped `region` is set by identify(),
  // which the HTTP path doesn't call, so it must ride on the identity instead).
  region?: string;
  // Name/email for Sentry feedback attribution (captureFeedback). The module-
  // scoped `me` is never populated on the HTTP path, so these must ride on the
  // per-request identity or hosted feedback lands anonymous even after
  // resolveIdentity() found the user.
  name?: string;
  email?: string;
}

export interface TelemetryHandle {
  // Returns a promise that resolves once identity settles (either /users/me
  // landed and we identified, or it failed and we fell back to anonymous).
  // Production callers (bin.ts) fire-and-forget; tests await the promise
  // to make capture assertions deterministic.
  identify(client: LeadbayClient): Promise<void>;
  // The optional `identity` arg is the per-request override (see CaptureIdentity).
  // Passing it also BYPASSES the pre-identity pending-events buffer — the caller
  // already has identity in hand, so there's nothing to wait for.
  captureToolCall(props: ToolCallProps, identity?: CaptureIdentity): void;
  captureCompositeCall(props: CompositeCallProps, identity?: CaptureIdentity): void;
  captureQuotaHit(props: QuotaHitProps, identity?: CaptureIdentity): void;
  captureTopupLink(props: TopupLinkProps, identity?: CaptureIdentity): void;
  captureStartup(props: StartupProps, identity?: CaptureIdentity): void;
  captureAgentMemoryCaptured(props: AgentMemoryCapturedProps, identity?: CaptureIdentity): void;
  captureAgentMemoryRecalled(props: AgentMemoryRecalledProps, identity?: CaptureIdentity): void;
  captureAgentMemoryPruned(props: AgentMemoryPrunedProps, identity?: CaptureIdentity): void;
  captureFrictionReported(props: FrictionReportedProps, identity?: CaptureIdentity): void;
  captureException(err: unknown, ctx: ExceptionCtx): void;
  // User-authored feedback → Sentry's feedback inbox, the SAME place the
  // web app's feedback form lands (Sentry.captureFeedback). name/email are
  // filled from the identified `/users/me` when available, mirroring the web
  // form. Returns true if it was actually sent to Sentry, false otherwise
  // (telemetry disabled / Sentry not ready) so the tool can report honestly.
  captureFeedback(message: string, opts?: { associatedEventId?: string }, identity?: CaptureIdentity): Promise<boolean>;
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
  captureToolCall: (_props?, _identity?) => {},
  captureCompositeCall: (_props?, _identity?) => {},
  captureQuotaHit: (_props?, _identity?) => {},
  captureTopupLink: (_props?, _identity?) => {},
  captureStartup: (_props?, _identity?) => {},
  captureAgentMemoryCaptured: () => {},
  captureAgentMemoryRecalled: () => {},
  captureAgentMemoryPruned: () => {},
  captureFrictionReported: () => {},
  captureException: () => {},
  captureFeedback: async () => false,
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
  // PostHog batching knobs. Default to the SDK-ish 20 / 10_000ms. The stdio
  // server (bin.ts) is short-lived and single-user — it passes flushAt:1 so
  // each event is handed off immediately rather than waiting for a 20-event
  // batch a brief session never reaches. The long-lived HTTP server keeps the
  // batching defaults (and flushes the tail via its SIGTERM/SIGINT hook).
  flushAt?: number;
  flushInterval?: number;
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
  const flushAt = opts.flushAt ?? 20;
  const flushInterval = opts.flushInterval ?? 10_000;
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
        flushAt,
        flushInterval,
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
        // Version is also encoded in `release` above, but a dedicated
        // `mcp_version` tag is filterable from Sentry's issue list without
        // expanding the release dropdown — load-bearing when triaging
        // "errors at reinstall on @0.13" vs older clients still on @0.11.
        initialScope: {
          tags: {
            source: "mcp",
            mcp_version: version,
            node_version: process.versions.node,
            platform: process.platform,
          },
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

  const doCapture = (
    event: string,
    properties: Record<string, unknown>,
    identity?: CaptureIdentity
  ) => {
    if (!posthog) return;
    try {
      // A per-call identity (HTTP multi-tenant path) overrides the module-scoped
      // distinctId/groups/region. Its region is merged into baseProps so the event
      // carries the caller's region even though identify() never ran for this handle.
      const props = identity?.region
        ? { ...baseProps(), region: identity.region, ...properties }
        : { ...baseProps(), ...properties };
      posthog.capture({
        distinctId: identity ? identity.distinctId : distinctIdFor(),
        event,
        properties: props,
        groups: identity ? identity.groups : groupsFor(),
      });
    } catch (err: any) {
      logger?.warn?.(`posthog capture failed: ${err?.message ?? err}`);
    }
  };

  const emit = (
    event: string,
    properties: Record<string, unknown>,
    identity?: CaptureIdentity
  ) => {
    if (!posthog) return;
    // A per-call identity means the caller already resolved who this is — there's
    // nothing to wait for, so skip the pre-identity buffer and capture now. The
    // buffer only bridges the stdio gap where identify() resolves async after boot.
    if (identity) {
      doCapture(event, properties, identity);
      return;
    }
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
    captureToolCall(props, identity) {
      emit(EV_TOOL_CALL, { ...props }, identity);
    },
    captureCompositeCall(props, identity) {
      emit(EV_COMPOSITE_CALL, { ...props }, identity);
    },
    captureQuotaHit(props, identity) {
      emit(EV_QUOTA_HIT, { ...props }, identity);
    },
    captureTopupLink(props, identity) {
      emit(EV_TOPUP_LINK, { ...props }, identity);
    },
    captureStartup(props, identity) {
      emit(EV_STARTUP, { ...props }, identity);
    },
    captureAgentMemoryCaptured(props, identity) {
      emit(EV_AGENT_MEMORY_CAPTURED, { ...props }, identity);
    },
    captureAgentMemoryRecalled(props, identity) {
      emit(EV_AGENT_MEMORY_RECALLED, { ...props }, identity);
    },
    captureAgentMemoryPruned(props, identity) {
      emit(EV_AGENT_MEMORY_PRUNED, { ...props }, identity);
    },
    captureFrictionReported(props, identity) {
      emit(EV_FRICTION_REPORTED, { ...props }, identity);
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
          if (ctx.code) scope.setTag("error_code", ctx.code);
          if (ctx.endpoint) scope.setTag("endpoint", ctx.endpoint);
          if (ctx.region) scope.setTag("region", ctx.region);
          if (ctx.http_status !== undefined) {
            scope.setTag("http_status", String(ctx.http_status));
          }
          if (ctx.source) scope.setTag("source", ctx.source);
          if (me?.organization?.id) {
            scope.setTag("organization", me.organization.id);
          }
          if (ctx.message) scope.setExtra("message", ctx.message);
          if (ctx.hint) scope.setExtra("hint", ctx.hint);
          if (ctx.triggered_by) scope.setExtra("triggered_by", ctx.triggered_by);
          if (ctx.latency_ms !== undefined && ctx.latency_ms !== null) {
            scope.setExtra("latency_ms", ctx.latency_ms);
          }
          if (ctx.retry_after !== undefined && ctx.retry_after !== null) {
            scope.setExtra("retry_after", ctx.retry_after);
          }
          // Fingerprint by (surface, tool, code) so business errors of the
          // same shape group together in Sentry rather than collapsing into
          // a single mega-issue (they all originate from client.makeError
          // and share the value-shape — default fingerprinting would dump
          // every LeadbayError into one bucket).
          if (ctx.code && ctx.source === "business") {
            scope.setFingerprint(["mcp", ctx.tool, ctx.code]);
          }
          Sentry.captureException(err);
        });
      } catch (e: any) {
        logger?.warn?.(`sentry captureException failed: ${e?.message ?? e}`);
      }
    },
    async captureFeedback(message, opts, identity) {
      // Mirrors the web app's feedback form (Sentry.captureFeedback with
      // name/email/message) so MCP feedback lands in the SAME Sentry inbox.
      // name/email come from the identified /users/me when available.
      if (!sentryReady) return false;
      const trimmed = (message ?? "").trim();
      if (!trimmed) return false;
      // A per-request identity (HTTP multi-tenant path) already resolved the
      // user for THIS request, so there's nothing to wait for — use it directly.
      // Without this, hosted feedback would fall through to the module-scoped
      // `me` (never populated on HTTP) and land anonymous even though
      // resolveIdentity() found the user (Codex P2). Only wait on identifyPromise
      // when no override is supplied (stdio, where identify() populates `me`).
      if (!identity && identityPromise) {
        // Wait (bounded) for /users/me so name/email attach — otherwise feedback
        // sent in the first second of a session (e.g. "report a bug" as the very
        // first message) lands ANONYMOUS and the team can't attribute or reply.
        // identify() is idempotent and fire-and-forget elsewhere; awaiting its
        // promise here doesn't re-trigger it. Cap at 2s so a hung /users/me can't
        // block the feedback — better an anonymous report than a dropped one.
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            identityPromise,
            new Promise<void>((resolve) => {
              waitTimer = setTimeout(resolve, 2000);
            }),
          ]);
        } catch {
          // identify() already swallows its own errors; ignore and proceed.
        } finally {
          // Clear the bounded-wait timer on the fast path (identity won the
          // race) so a dangling 2s timer can't keep a one-shot CLI alive past
          // exit or race the shutdown Sentry.close().
          if (waitTimer) clearTimeout(waitTimer);
        }
      }
      // Prefer the per-request identity's name/email (HTTP); fall back to the
      // module-scoped `me` (stdio, populated by identify()).
      const fbName = identity?.name ?? me?.name;
      const fbEmail = identity?.email ?? me?.email;
      try {
        Sentry.captureFeedback({
          message: trimmed,
          ...(fbName ? { name: fbName } : {}),
          ...(fbEmail ? { email: fbEmail } : {}),
          ...(opts?.associatedEventId
            ? { associatedEventId: opts.associatedEventId }
            : {}),
        });
        // Flush before returning. Feedback is queued (SDK flushInterval 10s),
        // and the MCP server is often short-lived (one-shot CLI, or a host that
        // disconnects right after the call) — the shutdown Sentry.close(2000)
        // races the buffered envelope and drops it. Awaiting a bounded flush
        // here makes `sent:true` actually mean "delivered to Sentry".
        const flushed = await Sentry.flush(4000);
        if (!flushed) {
          logger?.warn?.("sentry feedback flush timed out (event may be buffered)");
        }
        return flushed;
      } catch (e: any) {
        logger?.warn?.(`sentry captureFeedback failed: ${e?.message ?? e}`);
        return false;
      }
    },
    async shutdown() {
      // If identify() is still in flight (a short session exiting while
      // /users/me is mid-request), give it a brief bounded chance to land
      // before we fall back to anonymous — otherwise we'd stamp
      // "mcp:user-unknown" onto events that would have attributed correctly
      // milliseconds later. identify() resolves `me` and drains the buffer via
      // flushPending() itself, so on a win the `if (!me)` below is a no-op. The
      // 1.5s bound stays well inside posthog.shutdown's own 2s budget so a hung
      // /users/me still can't block process exit.
      if (!me && identityPromise) {
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            identityPromise,
            new Promise<void>((resolve) => {
              waitTimer = setTimeout(resolve, 1500);
            }),
          ]);
        } catch {
          // identify() swallows its own errors; ignore and fall through.
        } finally {
          if (waitTimer) clearTimeout(waitTimer);
        }
      }
      // If identity STILL hasn't resolved, events captured pre-identity are
      // sitting in pendingEvents and have NEVER reached posthog's own queue — so
      // posthog.shutdown() below would flush nothing and they'd be lost. Drain
      // them here, anonymously: reuse the SAME id:"unknown" fallback the
      // identify-failure path uses, so distinctIdFor() yields a stable
      // "mcp:user-unknown" (consistent with anonymous events from that path).
      // No-op when identity resolved (buffer already drained by flushPending()).
      if (!me) {
        me = {
          id: "unknown",
          organization: { id: "unknown", name: "unknown" },
        } as UserMePayload;
        flushPending();
      }
      // Bounded so a network hang can't block process exit.
      const tasks: Promise<unknown>[] = [];
      if (posthog) tasks.push(posthog.shutdown(2000).catch(() => undefined));
      if (sentryReady) tasks.push(Sentry.close(2000).catch(() => undefined));
      await Promise.allSettled(tasks);
    },
  };
}
