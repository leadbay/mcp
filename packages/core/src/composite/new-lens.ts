/**
 * leadbay_new_lens — create a named lens with sectors/sizes in one call.
 *
 * Default-surface composite. Clones a base lens (the active/default unless
 * `base` is given), names it, resolves free-text sectors against the taxonomy
 * (reusing adjust-audience's resolver so the ambiguity contract is identical),
 * and applies the filter — all in one step. Does NOT switch the active lens
 * (consistent with adjust_audience lensName); NEXT STEPS offers the switch.
 *
 * Distinct name from the granular leadbay_create_lens (POST /lenses) so the
 * tool-name identity audit doesn't collide when ADVANCED=1.
 *
 * Sectors that don't resolve are surfaced as ambiguous_sectors and the lens is
 * NOT created — we never leave a half-built lens behind.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, LensPayload, FilterPayload } from "../types.js";
import { resolveSectors, mergeFilter, filterWriteBody } from "./adjust-audience.js";

import { leadbay_new_lens as NEW_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface NewLensParams {
  name: string;
  sectors?: string[];
  exclude_sectors?: string[];
  sizes?: Array<{ min?: number; max?: number }>;
  base?: number; // lens id to clone from; defaults to the active/default lens
  description?: string;
  confirm?: boolean; // MUST be true to actually create; default = preview only
}

const EMPTY_FILTER: FilterPayload = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

export const newLens: Tool<NewLensParams> = {
  name: "leadbay_new_lens",
  annotations: {
    title: "Create a new named lens",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // each call creates a distinct lens
    openWorldHint: true,
  },
  description: NEW_LENS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name for the new lens (required)." },
      sectors: {
        type: "array",
        items: { type: "string" },
        description: "Sectors to include — free text (auto-resolved) or ids.",
      },
      exclude_sectors: {
        type: "array",
        items: { type: "string" },
        description: "Sectors to exclude — free text or ids.",
      },
      sizes: {
        type: "array",
        items: {
          type: "object",
          properties: { min: { type: "number" }, max: { type: "number" } },
        },
        description: "Company size buckets, e.g. [{min:30,max:300}].",
      },
      base: {
        type: "number",
        description:
          "Lens id to clone from. Defaults to the active/default lens.",
      },
      description: { type: "string", description: "Optional lens description." },
      confirm: {
        type: "boolean",
        description:
          "Safety gate. Defaults to false → the tool returns a PREVIEW and creates nothing. Show the preview to the user, get their explicit go-ahead, then re-call the SAME args with confirm:true to actually create the lens.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "'preview' (default, NOTHING created — confirm with the user then re-call with confirm:true); 'created' on success; 'ambiguous_sectors' when free-text sectors didn't resolve (re-call with sector ids — the lens was NOT created).",
    properties: {
      status: { type: "string", description: "'preview', 'created', or 'ambiguous_sectors'." },
      will_create: {
        type: "object",
        description:
          "On 'preview': what WILL be created — {name, description, sectors, exclude_sectors, sizes}. Nothing has been written yet.",
      },
      filter_preview: { type: "object", description: "On 'preview': the FilterPayload that would be applied." },
      lens: {
        type: "object",
        description: "On 'created': the created lens {id, name}.",
      },
      sector_ambiguities: {
        type: "array",
        description:
          "On 'ambiguous_sectors': per text {sector_text, matches:[{id,name,score}]}.",
        items: { type: "object" },
      },
      filter_applied: { type: "object", description: "On 'created': the FilterPayload POSTed to the new lens." },
      message: { type: "string" },
      _meta: { type: "object" },
    },
    required: ["status"],
  },
  execute: async (
    client: LeadbayClient,
    params: NewLensParams,
    ctx?: ToolContext
  ) => {
    // 1. Resolve sectors FIRST — if any don't resolve, surface and bail before
    //    creating a lens, so we never leave a half-built lens behind.
    const includeRes = await resolveSectors(
      client,
      params.sectors ?? [],
      ctx
    );
    const excludeRes = await resolveSectors(
      client,
      params.exclude_sectors ?? [],
      ctx
    );
    const ambiguities = [...includeRes.ambiguities, ...excludeRes.ambiguities];
    if (ambiguities.length > 0) {
      const noMatch = ambiguities.filter((a) => a.matches.length === 0);
      const multi = ambiguities.filter((a) => a.matches.length > 0);
      const parts: string[] = [];
      if (noMatch.length > 0) {
        parts.push(
          `Couldn't find a sector matching ${noMatch
            .map((a) => `"${a.sector_text}"`)
            .join(", ")}. Pick a known sector and re-call (lens not yet created).`
        );
      }
      if (multi.length > 0) {
        parts.push(
          `${multi
            .map((a) => `"${a.sector_text}"`)
            .join(", ")} matched multiple sectors. Pick from the matches and re-call with the sector id.`
        );
      }
      return {
        status: "ambiguous_sectors",
        sector_ambiguities: ambiguities,
        message: parts.join(" "),
      };
    }

    // Build the filter that WOULD be applied (used both for the preview and,
    // on confirm, the actual write).
    const merged = mergeFilter(
      EMPTY_FILTER,
      includeRes.resolved,
      excludeRes.resolved,
      params.sizes
    );

    // 2. Confirmation gate — never create silently. Unless confirm:true, return
    //    a preview of exactly what will be created and let the agent confirm
    //    with the user (via ask_user_input_v0) before re-calling with confirm.
    if (params.confirm !== true) {
      return {
        status: "preview",
        will_create: {
          name: params.name,
          description: params.description ?? null,
          sectors: includeRes.resolved,
          exclude_sectors: excludeRes.resolved,
          sizes: merged.lens_filter.items[0].criteria.find((c) => c.type === "size") ?? null,
        },
        filter_preview: merged,
        message: `About to create "${params.name}". Confirm with the user, then re-call with confirm:true.`,
        _meta: { region: client.region },
      };
    }

    // 3. Resolve the base lens to clone from.
    const base = params.base ?? (await client.resolveDefaultLens());

    // 4. Create the lens.
    // The backend's POST /lenses deserializer requires `base` as a STRING
    // (lens ids are strings server-side, e.g. "39107"); sending a number
    // yields 400 "JSON deserialization error". Coerce here — the rest of the
    // codebase carries ids as numbers, which is harmless for URL paths.
    const created = await client.request<LensPayload>("POST", "/lenses", {
      base: String(base),
      name: params.name,
      description: params.description,
    });

    // 5. Apply the filter (sectors/sizes) to the fresh lens.
    const hasCriteria = merged.lens_filter.items[0].criteria.length > 0;
    if (hasCriteria) {
      // POST /filter wants the unwrapped {items:[...]} body, not the envelope.
      await client.requestVoid(
        "POST",
        `/lenses/${created.id}/filter`,
        filterWriteBody(merged)
      );
    }

    // The lens list cache the client maintains is now stale.
    client.invalidateDefaultLens();

    return {
      status: "created",
      lens: { id: created.id, name: created.name },
      filter_applied: merged,
      message: `Created "${created.name}".`,
      _meta: { region: client.region },
    };
  },
};
