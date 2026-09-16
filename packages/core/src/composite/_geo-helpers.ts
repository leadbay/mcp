import type { LeadbayClient } from "../client.js";
import type { GeoMatch, GeoSearchResponse, LocationAmbiguity } from "../types.js";

/**
 * Free-text → admin_area id resolver, mirroring `resolveSectors` in
 * composite/adjust-audience.ts. Hits the backend's `/geo/search?q=`
 * endpoint and applies the same disambiguation rules:
 *
 *   - exact-name match (case-insensitive) → resolve
 *   - single result → resolve
 *   - else top match has a clear lead over runners-up → resolve
 *   - else → return as ambiguity
 *
 * Note: an id (a numeric string) passed in is forwarded as-is; the
 * caller (pull_followups, adjust_audience) shouldn't have to know
 * whether `city: "Berlin"` vs `city_id: "414522"` was supplied.
 */

const looksLikeId = (s: string) => /^\d+$/.test(s);

/**
 * Common US city abbreviations the backend's `/geo/search` doesn't
 * resolve directly (verified live: `q=NYC`, `q=SF`, `q=DC` all return
 * zero results). We pre-expand to the canonical phrase the backend
 * indexes; that surfaces the right admin_area on the first call instead
 * of forcing the agent to retry with a different spelling.
 *
 * Keys are normalised to lowercase + trimmed. Values are the verbatim
 * query we send to /geo/search. When the backend already accepts the
 * abbreviation (LA → "La Luz" etc. — confusingly a prefix match), the
 * alias still wins because we expand BEFORE the search.
 */
// Map values are the EXACT name the backend's /geo/search returns for
// the canonical level-5 city — picking these makes the top result an
// exact name match (score 1.0) which short-circuits the ambiguity
// resolver. Probed live against the US tenant.
const CITY_ALIASES: Record<string, string> = {
  nyc: "City of New York",
  "ny city": "City of New York",
  "new york": "City of New York", // user typing "New York" almost always means the city
  "new york city": "City of New York",
  manhattan: "City of New York",
  "the big apple": "City of New York",
  la: "Los Angeles",
  "l.a.": "Los Angeles",
  sf: "San Francisco",
  "s.f.": "San Francisco",
  "san fran": "San Francisco",
  dc: "Washington",
  "d.c.": "Washington",
  "washington d.c.": "Washington",
  "washington dc": "Washington",
  philly: "Philadelphia",
  vegas: "Las Vegas",
  nola: "New Orleans",
};

/**
 * Exported so `tour_plan` can put its client-side Discover filter through the
 * same table. "I'm going to NYC in 2 days" is the second most common tour ask
 * on prod, and the wishlist payload spells that city "City of New York".
 */
export function expandAlias(text: string): string {
  const key = text.trim().toLowerCase();
  return CITY_ALIASES[key] ?? text;
}

function scoreMatch(text: string, match: GeoMatch): number {
  const t = text.trim().toLowerCase();
  const n = match.name.trim().toLowerCase();
  if (n === t) return 1.0;
  if (n.startsWith(t)) return 0.6 + 0.2 * (t.length / n.length);
  // Jaccard over token sets — penalises matches with extra tokens (so
  // "Berlin" vs "New Berlin" scores 0.5, not 1.0).
  const wantTokens = new Set(t.split(/\s+/));
  const haveTokens = new Set(n.split(/\s+/));
  let intersect = 0;
  for (const w of wantTokens) if (haveTokens.has(w)) intersect += 1;
  const union = new Set([...wantTokens, ...haveTokens]).size;
  return union > 0 ? intersect / union : 0;
}

export async function resolveLocations(
  client: LeadbayClient,
  texts: string[]
): Promise<{ resolved: string[]; ambiguities: LocationAmbiguity[] }> {
  const direct = texts.filter((t) => looksLikeId(t));
  const free = texts.filter((t) => t && !looksLikeId(t));
  if (free.length === 0) return { resolved: direct, ambiguities: [] };

  const resolved: string[] = [...direct];
  const ambiguities: LocationAmbiguity[] = [];

  for (const originalText of free) {
    // Expand common abbreviations (NYC → New York City, SF → San
    // Francisco, …) BEFORE the search. The backend doesn't index
    // these aliases natively.
    const text = expandAlias(originalText);
    const path = `/geo/search?q=${encodeURIComponent(text)}`;
    let response: GeoSearchResponse;
    try {
      response = await client.request<GeoSearchResponse>("GET", path);
    } catch {
      // If the resolver itself errors, surface as a no-op ambiguity so
      // the caller can decide (re-prompt vs. drop).
      ambiguities.push({ location_text: originalText, matches: [] });
      continue;
    }
    const results = response.results ?? [];
    if (results.length === 0) {
      ambiguities.push({ location_text: originalText, matches: [] });
      continue;
    }

    // Score & rank. Two-key sort: primary by name match, secondary by
    // preferred admin level. Level 5 (city proper / consolidated city)
    // wins ties over level 4 (state), then level 6 (county), then
    // level 8 (city/town). This means "New York City" → "City of New
    // York (level 5)" rather than "New York (level 4, state)".
    const levelPreference = (level: number): number => {
      switch (level) {
        case 5: return 4; // city proper
        case 8: return 3; // standard city/town
        case 6: return 2; // county
        case 7: return 1; // township-area
        case 4: return 0; // state/region
        default: return 0;
      }
    };
    const ranked = results
      .map((r) => ({
        id: r.id,
        name: r.name,
        country: r.country,
        level: r.level,
        score: scoreMatch(text, r),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return levelPreference(b.level) - levelPreference(a.level);
      });

    const top = ranked[0];
    const runnerUp = ranked[1];
    const isConfident =
      top.score >= 0.95 || // exact-name match
      ranked.length === 1 ||
      (top.score >= 0.66 && (!runnerUp || top.score - runnerUp.score >= 0.34));

    if (isConfident) {
      resolved.push(top.id);
    } else {
      ambiguities.push({
        location_text: originalText,
        matches: ranked.slice(0, 5),
      });
    }
  }

  return { resolved, ambiguities };
}
