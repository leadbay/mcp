// Sector free text -> the exact taxonomy label the Leadbay API matches.
//
// `POST /mcp/search` resolves `filters.sectors` by an EXACT, case-sensitive
// label lookup, so on prod FR "Construction" is a 200 and "construction" is a
// 400, and no salesperson word ("Professional Services", "Event Venues") ever
// lands on a NACE/NAICS label. A scheduled agent re-reads the tool description
// on every run, so the 400 never teaches it and the run dies the same way each
// morning (product#4140).
//
// The same taxonomy rows are what `leadbay_list_sectors` returns, and every row
// carries `label`. `name` is never present — matching on it is why every
// free-text sector in `leadbay_new_lens` / `leadbay_adjust_audience` came back
// as an empty `matches` list (product#4100).
//
// Two things close the gap, and they are different:
//   - Spelling. Case, accents, punctuation, plurals, the "activities" /
//     "services" filler the registry adds. Closed silently here: the caller
//     meant exactly one label and we can prove which.
//   - Vocabulary. "Professional Services" is not a NACE label in any spelling.
//     Nothing here can pick for the agent, so the caller gets the labels to
//     choose from instead of a 400 that says "do not retry".
import type { LeadbayClient } from "../client.js";
import type { SectorPayload, ToolContext } from "../types.js";

/** The registry adds the same filler to thousands of labels; it carries no
 *  discriminating signal, and leaving it in is what makes "Real estate" miss
 *  "Real estate activities". Both languages, because a FR workspace serves its
 *  taxonomy in the user's language.
 *
 *  Grammar words and "activity" only. "Other", "except" and "n.e.c." are NOT
 *  filler: they mark the registry's residual buckets, which are the opposite of
 *  the broad node a caller naming a whole sector means. Dropping them made
 *  "Manufacturing" collapse onto "Manufacturing activities n.e.c." and
 *  "Informatique" onto "Autres activités informatiques" — a silent fence on the
 *  leftovers of the sector that was asked for. */
const FILLER = new Set([
  // en
  "and", "of", "the", "for", "or", "activity",
  // fr
  "et", "de", "des", "du", "d", "la", "le", "les", "l", "en", "aux", "au",
  "activite", "pour", "sur", "par", "a",
]);

/** Lowercase, strip diacritics, collapse everything that is not a letter or a
 *  digit. "Activités spécialisées" and "activites specialisees" are the same
 *  claim about the same sector. */
export function normalizeSectorText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, " ")
    .trim();
}

/** Crude plural fold, enough for "Restaurants" vs "Restaurant", "activities"
 *  vs "activity" and "activités" vs "activité". Applied to both sides, so a
 *  wrong fold costs a match rather than making a wrong one. */
function singular(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

/** The comparable words of a sector phrase. Filler is dropped, unless dropping
 *  it would leave nothing to compare (a label really called "Other services"). */
export function sectorTokens(value: string | null | undefined): string[] {
  const all = normalizeSectorText(value).split(" ").filter(Boolean).map(singular);
  const core = all.filter((t) => !FILLER.has(t));
  return core.length > 0 ? core : all;
}

/** The taxonomy returns `label`. `name` is accepted only so unit fixtures
 *  written against the old shape keep describing the same rows. */
export function sectorLabel(row: SectorPayload | null | undefined): string {
  if (!row) return "";
  const label = (row as { label?: unknown }).label;
  if (typeof label === "string" && label.length > 0) return label;
  return typeof row.name === "string" ? row.name : "";
}

function leadCount(row: SectorPayload): number {
  const n = (row as { number_of_leads?: unknown }).number_of_leads;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export interface SectorCandidate {
  id: string;
  /** The exact label to send back — copy it character for character. */
  name: string;
  score: number;
}

export type SectorMatch =
  /** One label, proven: the caller spelled it, or the words are the same words. */
  | { kind: "resolved"; label: string; ids: string[]; exact: boolean }
  /** Nothing provable. `candidates` are the closest labels, best first. */
  | { kind: "unresolved"; candidates: SectorCandidate[] };

const MAX_CANDIDATES = 8;
const MAX_PARTIAL_CANDIDATES = 4;

interface ScoredRow {
  row: SectorPayload;
  /** Share of the caller's words this label carries. */
  score: number;
  /** Share of the label's words the caller wrote — how much this label is
   *  ABOUT what was asked. */
  closeness: number;
}

/**
 * Best first. Coverage decides, then the tie-break the list is for:
 *  - `breadth` for labels that carry every word asked — the broad node before
 *    the leaf, so reading top-down never silently narrows the ask.
 *  - `closeness` for labels that carry only some of them — "Dental Laboratories"
 *    before "Used Household and Office Goods Moving", which is merely large.
 */
function rankCandidates(
  scored: ScoredRow[],
  tieBreak: "breadth" | "closeness"
): SectorCandidate[] {
  const out: SectorCandidate[] = [];
  const seen = new Set<string>();
  scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        (tieBreak === "breadth"
          ? leadCount(b.row) - leadCount(a.row) || b.closeness - a.closeness
          : b.closeness - a.closeness || leadCount(b.row) - leadCount(a.row)) ||
        sectorLabel(a.row).length - sectorLabel(b.row).length
    )
    .forEach(({ row, score }) => {
      const label = sectorLabel(row);
      if (!label || seen.has(label) || out.length >= MAX_CANDIDATES) return;
      seen.add(label);
      out.push({ id: row.id, name: label, score: Number(score.toFixed(2)) });
    });
  return out;
}

/**
 * Match one sector text against the taxonomy.
 *
 * Resolution is deliberately limited to the two cases where the answer is not
 * a judgement call: the caller wrote the label (modulo spelling), or the
 * caller's words ARE the label's words. A partial overlap is never resolved
 * here — "Warehouses" overlaps "Warehouse Clubs and Supercenters", and
 * silently fencing a search to retail warehouse clubs is worse than asking.
 */
export function matchSector(
  text: string,
  taxonomy: SectorPayload[]
): SectorMatch {
  const wanted = normalizeSectorText(text);
  if (!wanted) return { kind: "unresolved", candidates: [] };

  const exact = taxonomy.filter((row) => normalizeSectorText(sectorLabel(row)) === wanted);
  if (exact.length > 0) {
    const label = sectorLabel(
      exact.reduce((best, row) => (leadCount(row) > leadCount(best) ? row : best))
    );
    // Every row carrying this label, matching what the API does with a label it
    // recognises: the same name can sit at several registry depths.
    const ids = taxonomy.filter((row) => sectorLabel(row) === label).map((row) => row.id);
    return { kind: "resolved", label, ids, exact: true };
  }

  const want = new Set(sectorTokens(text));
  const sameWords = taxonomy.filter((row) => {
    const have = new Set(sectorTokens(sectorLabel(row)));
    return (
      have.size === want.size && [...want].every((token) => have.has(token))
    );
  });
  const sameWordLabels = new Set(sameWords.map((row) => sectorLabel(row)).filter(Boolean));
  if (sameWordLabels.size === 1) {
    const label = [...sameWordLabels][0];
    const ids = taxonomy.filter((row) => sectorLabel(row) === label).map((row) => row.id);
    return { kind: "resolved", label, ids, exact: false };
  }

  const scored: ScoredRow[] = [];
  for (const row of taxonomy) {
    const have = new Set(sectorTokens(sectorLabel(row)));
    if (have.size === 0) continue;
    let overlap = 0;
    for (const token of want) if (have.has(token)) overlap += 1;
    if (overlap === 0) continue;
    // How much of what the caller wrote this label covers. Which of two equally
    // covering labels comes first is decided by size, in rankCandidates.
    scored.push({ row, score: overlap / want.size, closeness: overlap / have.size });
  }
  // A label that carries every word the caller wrote is worth reading. One that
  // shares a word is mostly noise — "Professional Services" shares "services"
  // with sixty labels — so only a few are offered, and the sections carry the
  // ask when none of them fit.
  const full = scored.filter((s) => s.score >= 1);
  return {
    kind: "unresolved",
    candidates:
      full.length > 0
        ? rankCandidates(full, "breadth")
        : rankCandidates(scored, "closeness").slice(0, MAX_PARTIAL_CANDIDATES),
  };
}

/** The registry's top-level sections — 19 on NAICS, 21 on SIRENE. Short enough
 *  to hand back whole, and broad enough that a word with no label ("Professional
 *  Services", "IT Services") still has somewhere correct to land. */
export function sectorSections(taxonomy: SectorPayload[]): string[] {
  const roots = taxonomy.filter((row) => !(row as { parent?: unknown }).parent);
  const labels: string[] = [];
  for (const row of roots.sort((a, b) => leadCount(b) - leadCount(a))) {
    const label = sectorLabel(row);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** GET the visible taxonomy in the caller's language. The label join on the
 *  API side is language-agnostic, so a label read here resolves there whatever
 *  language the search itself runs in. */
export async function fetchSectorTaxonomy(
  client: LeadbayClient,
  ctx?: ToolContext
): Promise<SectorPayload[]> {
  const me = await client.resolveMe().catch(() => null);
  const lang = me?.language ?? "en";
  const taxonomy = await client.request<SectorPayload[]>(
    "GET",
    `/sectors/all?lang=${encodeURIComponent(lang)}&includeInvisible=false`
  );
  const unlabelled = taxonomy.filter((row) => !sectorLabel(row)).length;
  if (unlabelled > 0) {
    ctx?.logger?.warn?.(
      `sector taxonomy: ${unlabelled}/${taxonomy.length} row(s) carry no label`
    );
  }
  return taxonomy;
}

export interface SectorResolution {
  /** What to send as `filters.sectors`: numeric ids untouched, free text
   *  replaced by the exact label, values we could not prove left as written. */
  values: string[];
  /** Only the values whose spelling we changed — what to tell the user. */
  rewritten: Array<{ asked: string; used: string }>;
  unresolved: Array<{ asked: string; closest: SectorCandidate[] }>;
  sections: string[];
}

/** A bare number is already a taxonomy id; the API validates it directly. */
const NUMERIC_ID = /^\d+$/;

export function resolveSectorValues(
  values: string[],
  taxonomy: SectorPayload[]
): SectorResolution {
  const out: SectorResolution = {
    values: [],
    rewritten: [],
    unresolved: [],
    sections: sectorSections(taxonomy),
  };
  for (const raw of values) {
    const asked = typeof raw === "string" ? raw : String(raw ?? "");
    if (NUMERIC_ID.test(asked.trim())) {
      out.values.push(asked.trim());
      continue;
    }
    const match = matchSector(asked, taxonomy);
    if (match.kind === "resolved") {
      out.values.push(match.label);
      if (match.label !== asked) out.rewritten.push({ asked, used: match.label });
      continue;
    }
    out.values.push(asked);
    out.unresolved.push({ asked, closest: match.candidates });
  }
  return out;
}
