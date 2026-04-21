import { createClient, granularTools } from "@leadbay/core";

// OpenClaw plugin entry point.
//
// The OpenClaw adapter exposes the 11 granular tools (matching the published
// plugin manifest). Composite workflow tools live in @leadbay/mcp only.

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

  for (const tool of granularTools) {
    api.registerTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      ...(tool.optional ? { optional: true } : {}),
      execute: async (_id: string, params: unknown) =>
        tool.execute(client, params as any, { logger: api.logger }),
    });
  }
}
