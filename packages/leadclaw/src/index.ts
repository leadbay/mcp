import {
  createClient,
  InMemoryBulkStore,
  login,
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";
import type { Tool } from "@leadbay/core";

// OpenClaw plugin entry point.
//
// Tool exposure is gated by plugin config:
//   - composite read tools: ALWAYS exposed (the agent's default surface)
//   - composite write tools: ALWAYS exposed (OpenClaw runs in user context;
//     the agent has explicit consent. Write composites enforce their own
//     verification — e.g. report_outreach requires verification={source, ref}.)
//   - granular read tools: exposed only when exposeGranular=true
//   - granular write tools: exposed only when both exposeGranular=true
//     AND exposeWrite=true
//   - login: always exposed (this is the bootstrap path)

export function register(api: any) {
  const cfg = api.pluginConfig ?? {};

  const region = (cfg.region ?? "us") as "us" | "fr";
  let client;
  try {
    client = createClient({
      token: cfg.token,
      region,
      baseUrl: cfg.baseUrl,
    });
  } catch (err: any) {
    api.logger?.warn?.(
      `LeadClaw: ${err?.message ?? "Missing region config"}. Set it via: openclaw config set plugins.entries.leadclaw.region "us"`
    );
    return;
  }

  if (cfg.token) {
    api.logger?.info?.("LeadClaw: Using preconfigured auth token");
  }

  const exposeGranular = cfg.exposeGranular === true;
  const exposeWrite = cfg.exposeWrite === true;

  const exposed: Tool[] = [];
  exposed.push(login);
  exposed.push(...compositeReadTools);
  if (exposeWrite) {
    exposed.push(...compositeWriteTools);
  }
  if (exposeGranular) {
    exposed.push(...granularReadTools);
    if (exposeWrite) {
      exposed.push(...granularWriteTools);
    }
  }

  // BulkTracker: OpenClaw sandboxes filesystem access per-plugin, so the
  // default file-backed store isn't reliably writable. Use in-memory — the
  // handle lasts for the plugin session. MCP stdio deployments get file-backed
  // durability via @leadbay/mcp. Document this on leadbay_bulk_enrich_status.
  const bulkTracker = new InMemoryBulkStore({ logger: api.logger });

  // Dedup by name (some tools live in multiple lists; e.g. existing composites).
  const seen = new Set<string>();
  for (const tool of exposed) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    api.registerTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      ...(tool.optional || tool.write ? { optional: true } : {}),
      execute: async (_id: string, params: unknown) =>
        tool.execute(client, params as any, { logger: api.logger, bulkTracker }),
    });
  }

  api.logger?.info?.(
    `LeadClaw v0.2.0 registered: ${seen.size} tools (exposeGranular=${exposeGranular}, exposeWrite=${exposeWrite})`
  );
}
