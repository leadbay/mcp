import type { LeadbayClient } from "../client.js";
import type { Tool, SectorPayload } from "../types.js";
import { leadbay_list_sectors as LIST_SECTORS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ListSectorsParams {
  lang?: string;
  includeInvisible?: boolean;
}

export const listSectors: Tool<ListSectorsParams> = {
  name: "leadbay_list_sectors",
  annotations: {
    title: "List sector taxonomy",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LIST_SECTORS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      lang: { type: "string", description: "BCP-47 language tag (default: en)" },
      includeInvisible: {
        type: "boolean",
        description:
          "Include sectors hidden from the UI (default false; ~91k items if true)",
      },
    },
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: ListSectorsParams) => {
    // Prefer the caller's language when not specified — pulls from /me which
    // is cached, so no extra latency in steady state.
    let lang = params.lang;
    if (!lang) {
      try {
        const me = await client.resolveMe();
        lang = me.language ?? "en";
      } catch {
        lang = "en";
      }
    }
    const includeInvisible = params.includeInvisible ? "true" : "false";
    const path = `/sectors/all?lang=${encodeURIComponent(lang)}&includeInvisible=${includeInvisible}`;
    return await client.request<SectorPayload[]>("GET", path);
  },
};
