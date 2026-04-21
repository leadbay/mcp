import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { listLenses } from "../tools/list-lenses.js";
import { discoverLeads } from "../tools/discover-leads.js";

interface FindProspectsParams {
  lensName?: string;
  lensId?: number;
  count?: number;
}

export const findProspects: Tool<FindProspectsParams> = {
  name: "leadbay_find_prospects",
  description:
    "Find B2B prospects matching the user's Ideal Buyer Profile. Uses the active Leadbay lens by default. Returns scored lead summaries with AI qualification, recommended contact titles, and next-step suggestions. Start here for most lead-gen tasks.",
  inputSchema: {
    type: "object",
    properties: {
      lensName: {
        type: "string",
        description:
          "Lens name to search (optional). If omitted, uses the active lens. The lens defines the target market segment.",
      },
      lensId: {
        type: "number",
        description:
          "Lens ID (optional, takes precedence over lensName). Auto-resolves to the active lens if both omitted.",
      },
      count: {
        type: "number",
        description: "Number of prospects to return, max 50 (default: 20)",
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: FindProspectsParams,
    ctx?: ToolContext
  ) => {
    let lensId = params.lensId;

    if (!lensId && params.lensName) {
      // Resolve lensName → lensId
      const lensesResult = await listLenses.execute(client, {}, ctx);
      const match = (lensesResult.lenses as Array<{ id: number; name: string }>).find(
        (l) => l.name.toLowerCase() === params.lensName!.toLowerCase()
      );
      if (!match) {
        throw client.makeError(
          "LENS_NOT_FOUND",
          `No lens named "${params.lensName}" found`,
          "Call leadbay_list_lenses to see available lens names, or omit lensName to use the active lens."
        );
      }
      lensId = match.id;
    }

    return discoverLeads.execute(
      client,
      {
        lensId,
        count: params.count,
        page: 0,
      },
      ctx
    );
  },
};
