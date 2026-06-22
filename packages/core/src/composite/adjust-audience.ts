import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  FilterPayload,
  LensPayload,
  SectorPayload,
  FilterCriterion,
} from "../types.js";

import { resolveLocations } from "./_geo-helpers.js";
import { leadbay_adjust_audience as ADJUST_AUDIENCE_DESCRIPTION } from "../tool-descriptions.generated.js";
interface AdjustAudienceParams {
  sectors?: string[];           // free text or sector ids
  sector_ids?: string[];        // explicit ids if known
  exclude_sectors?: string[];   // free text or ids
  sizes?: Array<{ min?: number; max?: number }>;
  locations?: string[];         // free text (auto-resolved via /geo/search) or admin-area ids
  location_ids?: string[];      // explicit admin-area ids if known (skips resolution)
  exclude_locations?: string[]; // free text or ids to exclude
  lensId?: number;
  lensName?: string;             // target a lens by name (resolved → id); edit-only, does NOT switch active lens
  save_for_org?: boolean;        // admin only — propagate to org-level lens
  newLensName?: string;          // when default lens forces clone
}

export interface SectorAmbiguity {
  sector_text: string;
  matches: Array<{ id: string; name: string; score: number }>;
}

function tokens(s: string | null | undefined): string[] {
  // Guard: the sector taxonomy (and, defensively, the user's input array) can
  // carry null/undefined names. Without this, tokens(s.name) throws
  // "Cannot read properties of undefined (reading 'toLowerCase')" and the whole
  // resolveSectors → tool call dies while scanning the taxonomy — regardless of
  // what the user actually asked for.
  if (!s) return [];
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function bestMatches(
  text: string,
  taxonomy: SectorPayload[]
): Array<{ id: string; name: string; score: number }> {
  const want = new Set(tokens(text));
  if (want.size === 0) return [];
  const ranked = taxonomy
    .map((s) => {
      const have = new Set(tokens(s.name));
      let overlap = 0;
      for (const t of want) if (have.has(t)) overlap += 1;
      const score = overlap / Math.max(want.size, 1);
      return { id: s.id, name: s.name ?? "", score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, 5);
}

export async function resolveSectors(
  client: LeadbayClient,
  texts: string[],
  ctx?: ToolContext
): Promise<{ resolved: string[]; ambiguities: SectorAmbiguity[] }> {
  const looksLikeId = (s: string) => /^\d+$/.test(s);
  const direct = texts.filter(looksLikeId);
  const free = texts.filter((s) => !looksLikeId(s));
  if (free.length === 0) return { resolved: direct, ambiguities: [] };

  const me = await client.resolveMe().catch(() => null);
  const lang = me?.language ?? "en";
  const taxonomy = await client.request<SectorPayload[]>(
    "GET",
    `/sectors/all?lang=${encodeURIComponent(lang)}&includeInvisible=false`
  );

  // Surface bad backend data without changing behavior: the guard in tokens()
  // already makes null-name entries harmless, but a non-zero count here tells
  // us the taxonomy itself is dirty.
  const nullNames = taxonomy.filter((s) => !s.name).length;
  if (nullNames > 0) {
    ctx?.logger?.warn?.(
      `adjust_audience: /sectors/all returned ${nullNames}/${taxonomy.length} sector(s) with a null/missing name`
    );
  }

  const resolved = [...direct];
  const ambiguities: SectorAmbiguity[] = [];
  for (const text of free) {
    const matches = bestMatches(text, taxonomy);
    // Confident match: exactly one with score > 0.66 (most tokens match) AND
    // no close runner-up.
    if (
      matches.length === 1 ||
      (matches.length >= 2 && matches[0].score >= 0.66 && matches[0].score - matches[1].score >= 0.34)
    ) {
      resolved.push(matches[0].id);
    } else {
      ambiguities.push({ sector_text: text, matches });
    }
  }
  return { resolved, ambiguities };
}

interface LensNameMatch {
  id: number;
  name: string;
}

/**
 * Resolve a lens by name against GET /lenses. Mirrors the sector-resolution
 * contract: exactly one match → that lens; zero → not_found; >1 → ambiguous.
 * Matching is case-insensitive, exact first, then a unique substring fallback
 * (so "joinery" finds "Joinery audience"). Does NOT change the active lens.
 */
async function resolveLensByName(
  client: LeadbayClient,
  name: string
): Promise<
  | { ok: true; id: number }
  | { ok: false; reason: "not_found"; lenses: LensNameMatch[] }
  | { ok: false; reason: "ambiguous"; matches: LensNameMatch[] }
> {
  const lenses = await client.request<LensPayload[]>("GET", "/lenses");
  const all: LensNameMatch[] = lenses.map((l) => ({ id: l.id, name: l.name }));
  const needle = name.trim().toLowerCase();

  const exact = all.filter((l) => (l.name ?? "").trim().toLowerCase() === needle);
  if (exact.length === 1) return { ok: true, id: exact[0].id };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", matches: exact };

  const partial = all.filter((l) =>
    (l.name ?? "").toLowerCase().includes(needle)
  );
  if (partial.length === 1) return { ok: true, id: partial[0].id };
  if (partial.length > 1) return { ok: false, reason: "ambiguous", matches: partial };

  return { ok: false, reason: "not_found", lenses: all };
}

export function mergeFilter(
  current: FilterPayload,
  toAddSectors: string[],
  toExcludeSectors: string[],
  sizes: Array<{ min?: number; max?: number }> | undefined,
  toAddLocations: string[] = [],
  toExcludeLocations: string[] = []
): FilterPayload {
  const items = current?.lens_filter?.items ?? [];
  const item = items[0] ?? { criteria: [] };
  const criteria: FilterCriterion[] = item.criteria ? [...item.criteria] : [];

  // sector_ids (include) — merge into existing or add.
  if (toAddSectors.length > 0) {
    const idx = criteria.findIndex(
      (c) => c.type === "sector_ids" && !c.is_excluded
    );
    if (idx >= 0) {
      const cur = criteria[idx] as Extract<FilterCriterion, { type: "sector_ids" }>;
      const merged = Array.from(new Set([...(cur.sectors ?? []), ...toAddSectors]));
      criteria[idx] = { ...cur, sectors: merged };
    } else {
      criteria.push({
        type: "sector_ids",
        is_excluded: false,
        sectors: toAddSectors,
      });
    }
  }

  // sector_ids (exclude)
  if (toExcludeSectors.length > 0) {
    const idx = criteria.findIndex(
      (c) => c.type === "sector_ids" && c.is_excluded
    );
    if (idx >= 0) {
      const cur = criteria[idx] as Extract<FilterCriterion, { type: "sector_ids" }>;
      const merged = Array.from(new Set([...(cur.sectors ?? []), ...toExcludeSectors]));
      criteria[idx] = { ...cur, sectors: merged };
    } else {
      criteria.push({
        type: "sector_ids",
        is_excluded: true,
        sectors: toExcludeSectors,
      });
    }
  }

  // location_ids (include) — merge into existing or add. Mirrors sector_ids:
  // the backend echoes the resolved areas back in the FilterPayload.locations
  // block on read, but accepts only the id list on write.
  if (toAddLocations.length > 0) {
    const idx = criteria.findIndex(
      (c) => c.type === "location_ids" && !c.is_excluded
    );
    if (idx >= 0) {
      const cur = criteria[idx] as Extract<FilterCriterion, { type: "location_ids" }>;
      const merged = Array.from(new Set([...(cur.locations ?? []), ...toAddLocations]));
      criteria[idx] = { ...cur, locations: merged };
    } else {
      criteria.push({
        type: "location_ids",
        is_excluded: false,
        locations: toAddLocations,
      });
    }
  }

  // location_ids (exclude)
  if (toExcludeLocations.length > 0) {
    const idx = criteria.findIndex(
      (c) => c.type === "location_ids" && c.is_excluded
    );
    if (idx >= 0) {
      const cur = criteria[idx] as Extract<FilterCriterion, { type: "location_ids" }>;
      const merged = Array.from(new Set([...(cur.locations ?? []), ...toExcludeLocations]));
      criteria[idx] = { ...cur, locations: merged };
    } else {
      criteria.push({
        type: "location_ids",
        is_excluded: true,
        locations: toExcludeLocations,
      });
    }
  }

  // size — replace if provided (single canonical size criterion). The backend
  // deserializer requires BOTH min and max on every size bucket; "under N"
  // (max only) must carry min:0 or it 400s. Default the missing bound.
  if (sizes && sizes.length > 0) {
    // Backend requires both bounds and rejects out-of-range ints (e.g.
    // MAX_SAFE_INTEGER 400s). Default min→0; for an open-ended upper bound
    // use 1_000_000 (well above any real company headcount, within range).
    const normalizedSizes = sizes.map((s) => ({
      min: s.min ?? 0,
      max: s.max ?? 1_000_000,
    }));
    const idx = criteria.findIndex((c) => c.type === "size");
    if (idx >= 0) {
      criteria[idx] = { type: "size", is_excluded: false, sizes: normalizedSizes };
    } else {
      criteria.push({ type: "size", is_excluded: false, sizes: normalizedSizes });
    }
  }

  return {
    lens_filter: { items: [{ criteria }] },
    locations: current.locations ?? { results: [], parents: [] },
  };
}

/**
 * POST /lenses/:id/filter expects the UNWRAPPED body `{items:[{criteria}]}` —
 * NOT the `{lens_filter:{items}, locations}` envelope that GET returns (and
 * that mergeFilter produces). Sending the wrapped envelope 400s with
 * "JSON deserialization error". This adapts the merged FilterPayload to the
 * write shape. Verified live against the backend.
 */
export function filterWriteBody(filter: FilterPayload): { items: FilterPayload["lens_filter"]["items"] } {
  return { items: filter.lens_filter.items };
}

export const adjustAudience: Tool<AdjustAudienceParams> = {
  name: "leadbay_adjust_audience",
  annotations: {
    title: "Adjust lens audience filters",
    readOnlyHint: false,
    destructiveHint: true,
    // Each call MERGES new criteria into the lens config; calling twice
    // with the same args produces the same final state (last write wins on
    // overlapping criteria, but the merge is deterministic). Per spec
    // idempotentHint is about same observable outcome — re-call is safe.
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ADJUST_AUDIENCE_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      sectors: {
        type: "array",
        items: { type: "string" },
        description:
          "Sector free-text (e.g. ['Healthcare', 'Engineering']) or ids — auto-resolved",
      },
      sector_ids: {
        type: "array",
        items: { type: "string" },
        description: "Explicit sector ids (skips taxonomy lookup)",
      },
      exclude_sectors: {
        type: "array",
        items: { type: "string" },
        description: "Sectors to exclude (free text or ids)",
      },
      sizes: {
        type: "array",
        items: {
          type: "object",
          properties: { min: { type: "number" }, max: { type: "number" } },
        },
        description: "Company size buckets, e.g. [{min:30,max:300}]",
      },
      locations: {
        type: "array",
        items: { type: "string" },
        description:
          "Geographic scope — free text (e.g. ['Indre-et-Loire', 'Bavaria', 'Austin']) or admin-area ids. Auto-resolved via /geo/search across all admin levels (city / county / département / région / state / country). Place names go HERE, never in sectors/keywords.",
      },
      location_ids: {
        type: "array",
        items: { type: "string" },
        description: "Explicit admin-area ids (skips /geo/search resolution)",
      },
      exclude_locations: {
        type: "array",
        items: { type: "string" },
        description: "Locations to exclude (free text or ids)",
      },
      lensId: { type: "number", description: "Lens id (escape hatch)" },
      lensName: {
        type: "string",
        description:
          "Target a lens BY NAME (e.g. 'Joinery') instead of the active one. Resolved against your lenses — edit-only, does NOT switch your active lens. Unknown/ambiguous names are surfaced to pick from. Takes effect only when lensId is not given.",
      },
      save_for_org: {
        type: "boolean",
        description:
          "Admin only — propagate the change to the org-level lens for everyone (default false: per-user draft)",
      },
      newLensName: {
        type: "string",
        description:
          "Name to use when this composite has to clone the default lens (otherwise auto-named)",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Return shapes: 'applied' on success; 'ambiguous_sectors' when free-text sectors matched multiple candidates (re-call with sector_ids); 'ambiguous_locations' when free-text locations didn't resolve to one area (re-call with location_ids); 'lens_not_found' / 'ambiguous_lens' when a lensName didn't resolve to exactly one lens (re-call with lensId or an exact lensName).",
    properties: {
      status: {
        type: "string",
        description:
          "'applied', 'ambiguous_sectors', 'ambiguous_locations', 'lens_not_found', or 'ambiguous_lens'.",
      },
      sector_ambiguities: {
        type: "array",
        description:
          "Per ambiguous text: {sector_text, matches:[{id, name, score}]}. Agent picks an id and re-calls.",
        items: { type: "object" },
      },
      location_ambiguities: {
        type: "array",
        description:
          "On 'ambiguous_locations': per text {location_text, matches:[{id, name, country, level, score}]}. Agent picks an id and re-calls with location_ids.",
        items: { type: "object" },
      },
      lenses: {
        type: "array",
        description:
          "On 'lens_not_found': the user's lenses [{id, name}] to pick from.",
        items: { type: "object" },
      },
      matches: {
        type: "array",
        description:
          "On 'ambiguous_lens': the lenses [{id, name}] the name matched.",
        items: { type: "object" },
      },
      lens_query: {
        type: "string",
        description:
          "On 'lens_not_found' / 'ambiguous_lens': the lensName the user asked for.",
      },
      message: { type: "string" },
      lens_used: {
        type: "object",
        description:
          "Resolved lens metadata: {id, name, was_draft, was_new, active_lens_changed, save_for_org}.",
      },
      filter_applied: {
        type: "object",
        description: "The merged FilterPayload that was POSTed to the lens.",
      },
      _meta: { type: "object" },
    },
    required: ["status"],
  },
  execute: async (
    client: LeadbayClient,
    params: AdjustAudienceParams,
    ctx?: ToolContext
  ) => {
    const me = await client.resolveMe();
    const isAdmin = me.admin === true;

    // Resolve lensName → id when given (edit-only — does NOT switch the active
    // lens). Surfaces no-match / ambiguous the same way sectors do. An explicit
    // lensId wins and short-circuits name resolution (no wasted GET /lenses).
    let namedLensId: number | undefined;
    if (
      params.lensId == null &&
      params.lensName != null &&
      params.lensName.trim() !== ""
    ) {
      const res = await resolveLensByName(client, params.lensName);
      if (!res.ok && res.reason === "not_found") {
        return {
          status: "lens_not_found",
          lens_query: params.lensName,
          lenses: res.lenses,
          message: `No lens named "${params.lensName}". Pick one of the listed lenses (pass lensId or an exact lensName), or create it first.`,
        };
      }
      if (!res.ok && res.reason === "ambiguous") {
        return {
          status: "ambiguous_lens",
          lens_query: params.lensName,
          matches: res.matches,
          message: `"${params.lensName}" matched multiple lenses. Re-call with the exact lensName or the lensId of the one you mean.`,
        };
      }
      if (res.ok) namedLensId = res.id;
    }

    const startingLensId =
      params.lensId ?? namedLensId ?? me.last_requested_lens ?? (await client.resolveDefaultLens());

    // When the user targeted a lens BY NAME, the edit must not change which lens
    // is active (the lensName contract is edit-only). If editing that lens forces
    // a clone/draft, we still must NOT call update_last_requested — otherwise the
    // user is silently switched onto the new clone/draft. Guard the active-switch
    // on this flag below.
    const isNamedEdit = namedLensId != null && params.lensId == null;

    // Resolve free-text sectors (taxonomy lookup with fuzzy matching).
    const includeTexts = [
      ...(params.sectors ?? []),
      ...(params.sector_ids ?? []),
    ];
    const excludeTexts = params.exclude_sectors ?? [];

    const includeRes = await resolveSectors(client, includeTexts, ctx);
    const excludeRes = await resolveSectors(client, excludeTexts, ctx);
    const ambiguities = [
      ...includeRes.ambiguities,
      ...excludeRes.ambiguities,
    ];

    if (ambiguities.length > 0) {
      // Distinguish the two unresolved cases so the agent gets an actionable
      // message: no-match (matches: []) vs genuine multi-match ambiguity.
      const noMatch = ambiguities.filter((a) => a.matches.length === 0);
      const multi = ambiguities.filter((a) => a.matches.length > 0);
      const parts: string[] = [];
      if (noMatch.length > 0) {
        const names = noMatch.map((a) => `"${a.sector_text}"`).join(", ");
        parts.push(
          `Couldn't find a sector matching ${names}. Ask the user to rephrase or pick a known sector, then re-call with sector_ids=...`
        );
      }
      if (multi.length > 0) {
        const names = multi.map((a) => `"${a.sector_text}"`).join(", ");
        parts.push(
          `${names} matched multiple sectors. Pick from the matches and re-call with sector_ids=...`
        );
      }
      return {
        status: "ambiguous_sectors",
        sector_ambiguities: ambiguities,
        message: parts.join(" "),
      };
    }

    // Resolve free-text locations (admin-area lookup via /geo/search). An id
    // passed in is forwarded as-is, so `location_ids` folds into the include set.
    const includeLocTexts = [
      ...(params.locations ?? []),
      ...(params.location_ids ?? []),
    ];
    const excludeLocTexts = params.exclude_locations ?? [];

    const includeLocRes = await resolveLocations(client, includeLocTexts);
    const excludeLocRes = await resolveLocations(client, excludeLocTexts);
    const locAmbiguities = [
      ...includeLocRes.ambiguities,
      ...excludeLocRes.ambiguities,
    ];

    if (locAmbiguities.length > 0) {
      const noMatch = locAmbiguities.filter((a) => a.matches.length === 0);
      const multi = locAmbiguities.filter((a) => a.matches.length > 0);
      const parts: string[] = [];
      if (noMatch.length > 0) {
        const names = noMatch.map((a) => `"${a.location_text}"`).join(", ");
        parts.push(
          `Couldn't find a location matching ${names}. Ask the user to rephrase, then re-call with location_ids=...`
        );
      }
      if (multi.length > 0) {
        const names = multi.map((a) => `"${a.location_text}"`).join(", ");
        parts.push(
          `${names} matched multiple areas. Pick from the matches and re-call with location_ids=...`
        );
      }
      return {
        status: "ambiguous_locations",
        location_ambiguities: locAmbiguities,
        message: parts.join(" "),
      };
    }

    // Read the current lens (kind detection) + current filter.
    const lens = await client.request<LensPayload>(
      "GET",
      `/lenses/${startingLensId}`
    );
    const currentFilter = await client.request<FilterPayload>(
      "GET",
      `/lenses/${startingLensId}/filter`
    );
    const merged = mergeFilter(
      currentFilter,
      includeRes.resolved,
      excludeRes.resolved,
      params.sizes,
      includeLocRes.resolved,
      excludeLocRes.resolved
    );
    // The write endpoint wants the unwrapped {items:[...]} body, not the
    // {lens_filter, locations} envelope. `merged` stays the envelope for the
    // return value (filter_applied); mergedBody is what we POST.
    const mergedBody = filterWriteBody(merged);

    const isDefault = lens.is_default || lens.default;
    const isUserLevel = lens.user_id != null;
    const isOrgLevel = !isUserLevel && !isDefault;

    let targetLensId = startingLensId;
    let wasDraft = false;
    let wasNew = false;

    if (isDefault) {
      // Cannot edit default. Clone via POST /lenses {base, name}.
      // base MUST be a string — a numeric base yields 400 "JSON
      // deserialization error" (same backend contract as new_lens/create_lens).
      const name = params.newLensName ?? `Custom audience — ${new Date().toISOString().slice(0, 10)}`;
      const newLens = await client.request<LensPayload>("POST", "/lenses", {
        base: String(startingLensId),
        name,
      });
      targetLensId = newLens.id;
      wasNew = true;
      // Apply filter to the new lens.
      await client.requestVoid(
        "POST",
        `/lenses/${targetLensId}/filter`,
        mergedBody
      );
      // Set as active — UNLESS this was a named edit (lensName is edit-only and
      // must not change the active lens).
      if (!isNamedEdit) {
        await client.requestVoid(
          "POST",
          `/lenses/${targetLensId}/update_last_requested`
        );
      }
    } else if (isUserLevel) {
      try {
        await client.requestVoid(
          "POST",
          `/lenses/${startingLensId}/filter`,
          mergedBody
        );
      } catch (err: any) {
        if (err?.code === "FORBIDDEN") {
          // Edge: user-level but somehow forbidden — fall through to draft path.
          wasDraft = true;
          const draft = await client.request<LensPayload>(
            "POST",
            `/lenses/${startingLensId}/draft`
          );
          targetLensId = draft.id;
          await client.requestVoid(
            "POST",
            `/lenses/${targetLensId}/filter`,
            mergedBody
          );
          if (!isNamedEdit) {
            await client.requestVoid(
              "POST",
              `/lenses/${targetLensId}/update_last_requested`
            );
          }
        } else {
          throw err;
        }
      }
    } else if (isOrgLevel) {
      const goDraft = !isAdmin || !params.save_for_org;
      if (goDraft) {
        wasDraft = true;
        const draft = await client.request<LensPayload>(
          "POST",
          `/lenses/${startingLensId}/draft`
        );
        targetLensId = draft.id;
        try {
          await client.requestVoid(
            "POST",
            `/lenses/${targetLensId}/filter`,
            mergedBody
          );
        } catch (err: any) {
          // Orphan-draft handling: try DELETE; if not supported, surface for manual cleanup.
          ctx?.logger?.warn?.(
            `adjust_audience: filter on draft ${targetLensId} failed: ${err?.message}`
          );
          try {
            await client.requestVoid("DELETE", `/lenses/${targetLensId}`);
          } catch {
            return {
              error: true,
              code: "ORPHAN_DRAFT",
              message: `Draft ${targetLensId} created but filter update failed; draft cleanup also failed`,
              hint: `Use leadbay_promote_lens or leadbay_update_lens to recover, or open https://leadbay.app/lenses to manually delete draft lens ${targetLensId}.`,
              orphan_draft_id: targetLensId,
            };
          }
          throw err;
        }
        if (!isNamedEdit) {
          await client.requestVoid(
            "POST",
            `/lenses/${targetLensId}/update_last_requested`
          );
        }
      } else {
        // Admin + save_for_org=true → direct mutation.
        try {
          await client.requestVoid(
            "POST",
            `/lenses/${startingLensId}/filter`,
            mergedBody
          );
        } catch (err: any) {
          throw err;
        }
      }
    }

    // Cache invalidation. The active lens only changed when we actually called
    // update_last_requested (i.e. NOT a named edit). Always drop the default-lens
    // cache (lens set/contents changed); only drop /me when active may have moved.
    if (!isNamedEdit) client.invalidateMe();
    client.invalidateDefaultLens();

    // A named edit that forced a clone/draft did NOT switch the active lens, and
    // the edit landed on a NEW lens rather than the one named — say so plainly.
    const namedEditForkedMessage =
      isNamedEdit && (wasNew || wasDraft)
        ? ` Note: "${lens.name}" can't be edited in place, so the change was applied to a ${
            wasDraft ? "personal draft" : "new copy"
          } (id ${targetLensId}); your active lens is unchanged.`
        : "";

    return {
      status: "applied",
      lens_used: {
        id: targetLensId,
        name: lens.name,
        was_draft: wasDraft,
        was_new: wasNew,
        active_lens_changed: !isNamedEdit && (wasNew || wasDraft),
        save_for_org: params.save_for_org === true && isAdmin && isOrgLevel,
      },
      filter_applied: merged,
      message:
        (wasDraft
          ? "Applied to your personal draft of the org lens (your view only)."
          : wasNew
          ? `Created a new user-level lens "${lens.name}" with the filter (you can rename via leadbay_update_lens).`
          : "Applied directly to the lens.") + namedEditForkedMessage,
      _meta: { region: client.region },
    };
  },
};
