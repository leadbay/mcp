// The free identity pass: leadbay_qualify_leads with qualify:false and nothing
// to buy answers "is each of these companies in Leadbay, and what is its
// website and LinkedIn?" (product#4131).
//
// A delivered item carries the backend's whole QualifiedLead. For 82 broker
// names that was a 269,505-char result (FR prod, 2026-09-15, job ffbd024f),
// because `items` repeated every lead `leads` also carried. The question asked
// needs seven fields, so an identity pass answers with one row per company and
// the counts that tell the user what Leadbay has and what it lacks.
import {
  MAX_WAIT_SECONDS,
  TERMINAL_JOB_STATES,
  type McpJobItem,
  type McpJobSnapshot,
} from "./_mcp-job-helpers.js";
import { synthesizeCsv } from "./import-leads.js";
import type { ToolContext } from "../types.js";

/** Rows per tool result. At ~170 chars a row, 100 rows stay near 17k chars,
 *  well inside what a host inlines. A 500-ref job pages through
 *  leadbay_lead_job_status(compact: true, offset). */
export const IDENTITY_ROWS_PER_RESULT = 100;

export interface IdentityRow {
  /** Positions in the caller's lead_refs. Two refs that resolve to one lead
   *  share a row, so this can hold more than one. */
  input_indexes: number[] | null;
  /** What the user sent: the name, else the website, else the id. */
  input: string | null;
  status: McpJobItem["status"];
  status_reason?: string;
  lead_id?: string;
  name?: string;
  website?: string | null;
  linkedin?: string | null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toRow(item: McpJobItem): IdentityRow {
  const asked = (item.ref?.requested_as ?? {}) as Record<string, unknown>;
  const row: IdentityRow = {
    input_indexes: item.ref?.input_indexes ?? null,
    input:
      text(asked.name) ??
      text(asked.website) ??
      text(asked.lead_id) ??
      text(asked.contact_id),
    status: item.status,
  };
  if (item.status_reason) row.status_reason = item.status_reason;
  const lead = item.lead;
  if (!lead) return row;
  const company = lead.company ?? {};
  row.lead_id = lead.lead_id ?? item.ref?.lead_id ?? undefined;
  row.name = company.name;
  row.website = text(company.website);
  row.linkedin = text(company.socials?.linkedin);
  return row;
}

/** One row per job item, in the order of the caller's list. Items whose input
 *  position is unknown go last, in the order the job emitted them. */
export function identityRows(items: McpJobItem[]): IdentityRow[] {
  const first = (i: McpJobItem) => {
    const idx = i.ref?.input_indexes;
    return Array.isArray(idx) && idx.length > 0
      ? Math.min(...idx)
      : Number.MAX_SAFE_INTEGER;
  };
  return [...items]
    .sort((a, b) => first(a) - first(b) || a.seq - b.seq)
    .map(toRow);
}

/** What Leadbay has and what it lacks, over every row of the job. This count
 *  is the signal that stops an agent from looking the misses up one by one. */
export function identityCoverage(rows: IdentityRow[]) {
  let resolved = 0;
  let ambiguous = 0;
  let notFound = 0;
  let otherSkipped = 0;
  let withWebsite = 0;
  let withLinkedin = 0;
  for (const r of rows) {
    if (r.status !== "skipped") {
      resolved += 1;
      if (r.website) withWebsite += 1;
      if (r.linkedin) withLinkedin += 1;
    } else if (r.status_reason === "low_confidence_identity") ambiguous += 1;
    else if (r.status_reason === "not_in_universe") notFound += 1;
    else otherSkipped += 1;
  }
  return {
    resolved,
    ambiguous,
    not_found: notFound,
    other_skipped: otherSkipped,
    with_website: withWebsite,
    with_linkedin: withLinkedin,
    without_website: resolved - withWebsite,
  };
}

const CSV_HEADER = [
  "row",
  "input",
  "status",
  "reason",
  "company",
  "website",
  "linkedin",
  "lead_id",
];

/** Every row as a CSV a spreadsheet opens. `row` is the 1-based line in the
 *  user's list; two lines that resolved to one company share a row. Cells go
 *  through the import path's escaping, formula-injection guard included. */
export function identityCsv(rows: IdentityRow[]): string {
  return synthesizeCsv(
    CSV_HEADER,
    rows.map((r) => ({
      row: (r.input_indexes ?? []).map((i) => i + 1).join(";"),
      input: r.input ?? "",
      status: r.status,
      reason: r.status_reason ?? "",
      company: r.name ?? "",
      website: r.website ?? "",
      linkedin: r.linkedin ?? "",
      lead_id: r.lead_id ?? "",
    }))
  );
}

/** Local install only: saves every row of a finished job as a CSV on the
 *  user's disk and returns its path. Nothing is written when ctx.saveFile is
 *  absent (the hosted server), while the job still runs, or when the read
 *  stopped early, because that file would be missing rows. A failed write
 *  is reported and never fails the call: the rows are still in the result. */
export async function saveIdentityFile(
  ctx: ToolContext | undefined,
  jobId: string,
  snapshot: McpJobSnapshot,
  items: McpJobItem[]
): Promise<{ file?: string; file_error?: string }> {
  if (!ctx?.saveFile) return {};
  if (!TERMINAL_JOB_STATES.has(snapshot.job.state)) return {};
  if (snapshot.items_truncated || items.length === 0) return {};
  try {
    const name = `leadbay-companies-${jobId.slice(0, 8)}.csv`;
    return { file: await ctx.saveFile(name, identityCsv(identityRows(items))) };
  } catch (e) {
    return { file_error: e instanceof Error ? e.message : String(e) };
  }
}

/** Hosts send numbers as strings; anything unreadable starts at the top. */
export function readOffset(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The fields both leadbay_qualify_leads and leadbay_lead_job_status return
 *  for an identity pass: counts over the whole job, one page of rows, and
 *  where the next page starts. */
export function identityAnswer(
  jobId: string,
  snapshot: McpJobSnapshot,
  items: McpJobItem[],
  offset: number
) {
  const all = identityRows(items);
  const rows = all.slice(offset, offset + IDENTITY_ROWS_PER_RESULT);
  const end = offset + rows.length;
  const done = TERMINAL_JOB_STATES.has(snapshot.job.state);
  const truncated = snapshot.items_truncated ?? false;
  // A running job, or a drain that stopped early, re-reads from the top: its
  // set of rows is still changing. A finished job pages on by row.
  const nextOffset = !done || truncated ? 0 : end < all.length ? end : null;
  return {
    summary: {
      ...identityCoverage(all),
      stop_reason: snapshot.funnel?.stop_reason ?? null,
    },
    rows,
    rows_total: all.length,
    rows_offset: offset,
    items_truncated: truncated,
    scope_notes: snapshot.explain?.scope_notes ?? [],
    still_running: !done,
    next_poll:
      nextOffset === null
        ? null
        : {
            tool: "leadbay_lead_job_status",
            job_id: jobId,
            compact: true,
            offset: nextOffset,
            suggested_wait_seconds: done ? 0 : MAX_WAIT_SECONDS,
          },
  };
}
