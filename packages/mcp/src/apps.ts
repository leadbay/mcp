// MCP Apps (SEP-1865) — the finished Leadbay boards, served as the views a
// host renders next to a tool's result.
//
// NEVER on a Claude surface. Claude renders an MCP App as a sandboxed iframe
// and then stops routing to its own first-party widgets (CLAUDE.md, "Rendering
// surface"), so /mcp and the .dxt bundle build with includeApps off. The apps
// endpoints (/chatgpt/mcp, /apps/mcp) and a stdio install with
// LEADBAY_MCP_APPS=1 turn it on — see http-server.ts APP_PATHS and bin.ts.
//
// A view is the same page the kit hands an agent to publish as a Claude
// artifact (ARTIFACT_TEMPLATES): one board, three surfaces. The page finds the
// MCP Apps host on its own (components/src/mcp-app-bridge.ts), so the HTML is
// served byte-for-byte as the kit builds it.

import { ARTIFACT_TEMPLATES } from "@leadbay/core";

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

interface McpApp {
  uri: string;
  /** Key into ARTIFACT_TEMPLATES. */
  template: string;
  /** The model-facing tool whose result the host shows this view for. */
  tool: string;
}

const MCP_APPS: McpApp[] = [
  { uri: "ui://leadbay/triage-board", template: "triage_board", tool: "leadbay_pull_leads" },
];

/** The view a tool's result renders in, or undefined for a plain tool. */
export function appResourceUriFor(toolName: string): string | undefined {
  return MCP_APPS.find((a) => a.tool === toolName)?.uri;
}

export function listAppResources() {
  return MCP_APPS.map((a) => {
    const t = ARTIFACT_TEMPLATES[a.template];
    return { uri: a.uri, name: t.title, description: t.description, mimeType: MCP_APP_MIME_TYPE };
  });
}

/** The resources/read answer for a view, or null when `uri` is not one. */
export function readAppResource(uri: string) {
  const app = MCP_APPS.find((a) => a.uri === uri);
  if (!app) return null;
  return {
    contents: [
      {
        uri,
        mimeType: MCP_APP_MIME_TYPE,
        text: ARTIFACT_TEMPLATES[app.template].html,
        // No csp block: the board loads nothing from the network — every read
        // and write is a tools/call through the host — so the spec's
        // restrictive default policy is the right one.
        _meta: { ui: { prefersBorder: true } },
      },
    ],
  };
}
