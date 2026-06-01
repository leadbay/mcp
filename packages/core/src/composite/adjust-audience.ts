import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  FilterPayload,
  LensPayload,
  SectorPayload,
  FilterCriterion,
} from "../types.js";

import { leadbay_adjust_audience as ADJUST_AUDIENCE_DESCRIPTION } from "../tool-descriptions.generated.js";
interface AdjustAudienceParams {
  sectors?: string[];           // free text or sector ids
  sector_ids?: string[];        // explicit ids if known
  exclude_sectors?: string[];   // free text or ids
  sizes?: Array<{ min?: number; max?: number }>;
  // (Locations resolution is a separate beast; not modelled here yet.)
  lensId?: number;
  save_for_org?: boolean;        // admin only — propagate to org-level lens
  newLensName?: string;          // when default lens forces clone
}

interface SectorAmbiguity {
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

async function resolveSectors(
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

function mergeFilter(
  current: FilterPayload,
  toAddSectors: string[],
  toExcludeSectors: string[],
  sizes: Array<{ min?: number; max?: number }> | undefined
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

  // size — replace if provided (single canonical size criterion).
  if (sizes && sizes.length > 0) {
    const idx = criteria.findIndex((c) => c.type === "size");
    if (idx >= 0) {
      criteria[idx] = { type: "size", is_excluded: false, sizes };
    } else {
      criteria.push({ type: "size", is_excluded: false, sizes });
    }
  }

  return {
    lens_filter: { items: [{ criteria }] },
    locations: current.locations ?? { results: [], parents: [] },
  };
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
      lensId: { type: "number", description: "Lens id (escape hatch)" },
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
      "Two return shapes: 'ambiguous_sectors' when free-text sectors matched multiple candidates (agent re-calls with sector_ids), 'applied' on success.",
    properties: {
      status: {
        type: "string",
        description: "'ambiguous_sectors' or 'applied'.",
      },
      sector_ambiguities: {
        type: "array",
        description:
          "Per ambiguous text: {sector_text, matches:[{id, name, score}]}. Agent picks an id and re-calls.",
        items: { type: "object" },
      },
      message: { type: "string" },
      lens_used: {
        type: "object",
        description:
          "Resolved lens metadata: {id, name, was_draft, was_new, save_for_org}.",
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
    const startingLensId =
      params.lensId ?? me.last_requested_lens ?? (await client.resolveDefaultLens());

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
      params.sizes
    );

    const isDefault = lens.is_default || lens.default;
    const isUserLevel = lens.user_id != null;
    const isOrgLevel = !isUserLevel && !isDefault;

    let targetLensId = startingLensId;
    let wasDraft = false;
    let wasNew = false;

    if (isDefault) {
      // Cannot edit default. Clone via POST /lenses {base, name}.
      const name = params.newLensName ?? `Custom audience — ${new Date().toISOString().slice(0, 10)}`;
      const newLens = await client.request<LensPayload>("POST", "/lenses", {
        base: startingLensId,
        name,
      });
      targetLensId = newLens.id;
      wasNew = true;
      // Apply filter to the new lens.
      await client.requestVoid(
        "POST",
        `/lenses/${targetLensId}/filter`,
        merged
      );
      // Set as active.
      await client.requestVoid(
        "POST",
        `/lenses/${targetLensId}/update_last_requested`
      );
    } else if (isUserLevel) {
      try {
        await client.requestVoid(
          "POST",
          `/lenses/${startingLensId}/filter`,
          merged
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
            merged
          );
          await client.requestVoid(
            "POST",
            `/lenses/${targetLensId}/update_last_requested`
          );
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
            merged
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
        await client.requestVoid(
          "POST",
          `/lenses/${targetLensId}/update_last_requested`
        );
      } else {
        // Admin + save_for_org=true → direct mutation.
        try {
          await client.requestVoid(
            "POST",
            `/lenses/${startingLensId}/filter`,
            merged
          );
        } catch (err: any) {
          throw err;
        }
      }
    }

    // Cache invalidation — the active lens may have changed.
    client.invalidateMe();
    client.invalidateDefaultLens();

    return {
      status: "applied",
      lens_used: {
        id: targetLensId,
        name: lens.name,
        was_draft: wasDraft,
        was_new: wasNew,
        save_for_org: params.save_for_org === true && isAdmin && isOrgLevel,
      },
      filter_applied: merged,
      message: wasDraft
        ? "Applied to your personal draft of the org lens (your view only)."
        : wasNew
        ? `Created a new user-level lens "${lens.name}" with the filter (you can rename via leadbay_update_lens).`
        : "Applied directly to the lens.",
      _meta: { region: client.region },
    };
  },
};
