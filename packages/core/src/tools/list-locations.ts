import type { LeadbayClient } from "../client.js";
import type { Tool, GeoSearchResponse } from "../types.js";
import { leadbay_list_locations as LIST_LOCATIONS_DESCRIPTION } from "../tool-descriptions.generated.js";
import {
  countryLocationStatus,
  detectCountryLocations,
} from "../composite/_country-guard.js";

interface ListLocationsParams {
  q: string;
}

export const listLocations: Tool<ListLocationsParams, GeoSearchResponse> = {
  name: "leadbay_list_locations",
  annotations: {
    title: "Search the geo / admin-area taxonomy",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LIST_LOCATIONS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description:
          "Free-text city / region name (e.g. 'Berlin', 'NYC', 'São Paulo'). Returns top-10 prefix matches sorted by relevance, each with an admin_area id usable in FilterCriterion.location_ids. A COUNTRY name is refused — the index holds no country nodes, so the lookup could only return a same-named town.",
      },
    },
    required: ["q"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        description:
          "Matches sorted by relevance. Each entry: {id, country, level, name, parent_ids}. `level` is admin depth (5=region, 6=county, 7=township-area, 8=city/town).",
        items: { type: "object" },
      },
      parents: {
        type: "array",
        description:
          "Parent admin areas referenced by `results[].parent_ids`, returned for breadcrumb / hover-disambiguation rendering.",
        items: { type: "object" },
      },
      status: {
        type: "string",
        description:
          "`country_level_location` when `q` was a country name — `results` is empty on purpose. This workspace serves exactly ONE country, so there is no country to look up and no id to pass on. Absent on the happy path.",
      },
      country_locations: {
        type: "array",
        description:
          "Per offending value: {value, param, kind, country}. Only present when `status === 'country_level_location'`.",
        items: { type: "object" },
      },
    },
    required: ["results", "parents"],
  },
  execute: async (client: LeadbayClient, params: ListLocationsParams) => {
    const q = (params.q ?? "").trim();
    if (!q) return { results: [], parents: [] };
    // This is the tool that HANDS OUT the ids other tools filter on, so
    // refusing a country lookup here is the single highest-leverage stop:
    // there is no country node to return, only a same-named town, and an id
    // pasted from such a result fences the caller to one village with no
    // visible sign (product#3951). Matches this tool's own idiom — an empty
    // `q` already returns an envelope rather than throwing.
    const countryHits = detectCountryLocations(q, "q", client.region);
    if (countryHits.length > 0) {
      return {
        results: [],
        parents: [],
        ...countryLocationStatus(countryHits, client.region),
      };
    }
    const path = `/geo/search?q=${encodeURIComponent(q)}`;
    return await client.request<GeoSearchResponse>("GET", path);
  },
};
