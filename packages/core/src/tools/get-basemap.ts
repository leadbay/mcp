import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_get_basemap as GET_BASEMAP_DESCRIPTION } from "../tool-descriptions.generated.js";
import { ARTIFACT_BASEMAPS } from "../artifact-templates.generated.js";

// The country outline a map board draws under its pins, for the workspace's
// own region. Called BY the board's script — the route planner template —
// never by the agent.
//
// It exists because an artifact cannot fetch a file from anywhere but its own
// published files, and an agent building a board for someone else has no
// outline file to publish. Serving it here means every board gets the same
// outline, from the same place, for the right country.
//
// No backend call: the outlines are bundled with the server. The region is the
// client's own (a workspace serves exactly one country), so there is nothing
// for the caller to choose.

export interface GetBasemapParams {}

export const getBasemap: Tool<GetBasemapParams> = {
  name: "leadbay_get_basemap",
  annotations: {
    title: "Country outline for a map board",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: GET_BASEMAP_DESCRIPTION,
  write: false,
  // No outputSchema on purpose: with one the server would also send the
  // ~570 KB outline as structuredContent, doubling every board's load.
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, _params: GetBasemapParams, _ctx?: ToolContext) => {
    const region = String(client.region || "").toLowerCase();
    // A JSON STRING, not an object: the server pretty-prints every result, and
    // an outline as an object comes out ~4.5x larger. The page JSON.parses it.
    const geojson = ARTIFACT_BASEMAPS[region];
    if (!geojson) {
      throw client.makeError(
        "NO_BASEMAP",
        `No country outline for region "${region}"`,
        "The board still works without it: pins, list and routes need no outline.",
      );
    }
    return { region, geojson };
  },
};
