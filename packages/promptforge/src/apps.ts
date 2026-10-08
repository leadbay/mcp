// `{{apps}}` — mark prose that only exists where the MCP Apps boards are served.
//
// On /chatgpt/mcp, /apps/mcp and a stdio install with LEADBAY_MCP_APPS=1 the
// host can render a finished Leadbay board next to a tool's result
// (packages/mcp/src/apps.ts). A tool description there has to say so — or the
// agent redraws the same leads as a markdown table under the board. Claude
// never gets the board, so on the Claude surface that sentence must not exist.
//
//   {{apps}}
//   **When the host shows the Leadbay board for this call** …
//   {{/apps}}
//
// The REVERSE of `{{commerce}}`: the DEFAULT rendering (Claude) deletes the
// block, and only the apps rendering keeps it. So every Claude description
// stays byte-for-byte what it was before the marker existed. Same delete-only
// rule, same block and inline shapes — see markers.ts.

import { surfaceMarker, type MarkerMode } from "./markers.js";

export type AppsMode = MarkerMode;

const apps = surfaceMarker("apps");

export function hasAppsMarkers(body: string): boolean {
  return apps.has(body);
}

export function validateAppsMarkers(body: string): string | null {
  return apps.validate(body);
}

/** "with" keeps the `{{apps}}` blocks (apps surfaces); "without" deletes them (Claude). */
export function renderApps(body: string, mode: AppsMode): string {
  return apps.render(body, mode);
}
