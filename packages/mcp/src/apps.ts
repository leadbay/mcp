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
  /** Origins the page loads static files from (CSP `resourceDomains`). Omit
   *  when the page loads nothing: the spec's restrictive default then holds. */
  resourceDomains?: string[];
}

const MCP_APPS: McpApp[] = [
  { uri: "ui://leadbay/triage-board", template: "triage_board", tool: "leadbay_pull_leads" },
  // Leaflet comes from cdnjs (route-planner/page.html). The country outline
  // and the leads are tool calls, and there are no map tiles, so nothing else
  // is fetched.
  {
    uri: "ui://leadbay/route-planner",
    template: "route_planner",
    tool: "leadbay_followups_map",
    resourceDomains: ["https://cdnjs.cloudflare.com"],
  },
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
        // Every read and write is a tools/call through the host. A board that
        // also loads a script declares that origin and nothing more; one that
        // loads nothing gets no csp block, so the spec's restrictive default
        // holds.
        _meta: {
          ui: {
            prefersBorder: true,
            ...(app.resourceDomains ? { csp: { resourceDomains: app.resourceDomains } } : {}),
          },
        },
      },
    ],
  };
}
