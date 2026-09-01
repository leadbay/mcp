/**
 * Shared reading of the file-import wizard's `/imports/{id}/records` payload.
 *
 * Two callers need the same primitives from different starting points:
 *
 *   - `import-leads.ts` reconciles records against the inputs it just uploaded,
 *     so it can key on its own `MCP_ROW_ID` index and knows every row it sent.
 *   - `import-status.ts` (product#4007) reconciles records with NO client-side
 *     state at all — the caller only handed it `importIds[]`. That path exists
 *     because the hosted MCP has no BulkTracker, so `importIds` is the only
 *     resumable handle a timed-out import can hand back.
 *
 * The cell reader, domain normalizer and mailbox list live here so the second
 * caller doesn't have to import the whole import tool to read a record.
 */

import type { ImportRecordPayload } from "../types.js";

// Strip protocol/path/trailing slash; lowercase. Returns null for clearly
// malformed input. The TLD shape check is intentionally loose — Leadbay
// supports unusual TLDs (.io, .ai, .gov.uk, etc.) so we only require: at
// least one dot, at least 2 chars on each side of the rightmost dot, no
// whitespace, no scheme leftovers.
export function normalizeDomain(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  let v = input.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/^www\./, "");
  v = v.split("/")[0].split("?")[0].split("#")[0];
  v = v.replace(/\.+$/, "");
  if (!v) return null;
  if (/\s/.test(v)) return null;
  if (!v.includes(".")) return null;
  if (v.startsWith(".") || v.endsWith(".")) return null;
  const parts = v.split(".");
  if (parts.length < 2) return null;
  if (parts.some((p) => p.length === 0)) return null;
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith("xn--")) return null;
  if (!/^[a-z0-9-]+$/.test(parts[parts.length - 2])) return null;
  return v;
}

// Public mailbox / generic domains. We do NOT denylist these (per user
// decision in /autoplan CEO phase). The list lives here so the reconciler
// can label `no_match` records that are mailbox-y as `no_match`, while
// genuinely unknown company domains get `uncrawled`. This is a *labeling*
// distinction, not a *gating* one — the wizard sees every domain.
export const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "tutanota.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  // Regional aliases of the same providers, plus the consumer ISP mailboxes
  // that dominate a French user base. Without these, `orange.fr` or
  // `yahoo.fr` reads as a company domain (codex review, mcp#188).
  "yahoo.fr",
  "yahoo.co.uk",
  "yahoo.es",
  "yahoo.it",
  "yahoo.de",
  "yahoo.ca",
  "yahoo.com.br",
  "yahoo.co.jp",
  "hotmail.fr",
  "hotmail.co.uk",
  "hotmail.es",
  "hotmail.it",
  "hotmail.de",
  "hotmail.be",
  "outlook.fr",
  "outlook.es",
  "outlook.de",
  "outlook.it",
  "live.fr",
  "live.be",
  "live.co.uk",
  "msn.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "bbox.fr",
  "neuf.fr",
  "aliceadsl.fr",
  "numericable.fr",
  "club-internet.fr",
  "gmx.fr",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "t-online.de",
  "libero.it",
  "wp.pl",
  "seznam.cz",
]);

// The synthetic column import-leads injects at header[0] so a record can be
// traced back to the row the caller passed in. Round-trips through the CSV,
// which is what lets the status-side reconciler work statelessly.
export const MCP_ROW_ID_COLUMN = "MCP_ROW_ID";

// Pull a column value by name (case-insensitive) from a record's records[]
// array. Live wire format (probed 2026-04-28): each entry is
// { column_name, value, field? }. Some test mocks use the older
// { cells: { ColumnName: value } } shape; tolerate both.
export function readCell(record: ImportRecordPayload, key: string): string | null {
  const want = key.toLowerCase();
  const arr: any = (record as any).records;
  if (Array.isArray(arr)) {
    for (const c of arr) {
      const k = (c?.column_name ?? c?.key ?? c?.field ?? "").toString().toLowerCase();
      if (k === want) {
        const v = c?.value ?? null;
        return v != null ? String(v) : null;
      }
    }
  }
  const cells = (record as any).cells;
  if (cells && typeof cells === "object" && !Array.isArray(cells)) {
    for (const [k, v] of Object.entries(cells)) {
      if (k.toLowerCase() === want) {
        return v != null ? String(v) : null;
      }
    }
  }
  if (Array.isArray(cells)) {
    for (const c of cells) {
      const k = (c?.key ?? c?.field ?? c?.column_name ?? "").toString().toLowerCase();
      if (k === want) {
        const v = c?.value ?? null;
        return v != null ? String(v) : null;
      }
    }
  }
  return null;
}

export function recordMatchType(record: ImportRecordPayload): string {
  return ((record as any).match_type ?? (record as any).matchType ?? "")
    .toString()
    .toUpperCase();
}

// A record is terminal once the wizard has either linked it to a lead
// (status IMPORTED) or given up on matching it (NO_MATCH). Anything else is
// still moving — see `isSettled` for why the status reconciler cares.
export function isRecordTerminal(record: ImportRecordPayload): boolean {
  const status = (record.status ?? "").toString().toUpperCase();
  return recordMatchType(record) === "NO_MATCH" || status === "IMPORTED";
}

export interface ReconciledLead {
  rowId?: string;
  domain?: string;
  leadId: string;
  name: string | null;
}

export interface ReconciledNotImported {
  rowId?: string;
  domain?: string;
  reason: "no_match" | "uncrawled";
}

export interface ReconciledRecords {
  leads: ReconciledLead[];
  not_imported: ReconciledNotImported[];
  // Rows actually considered, AFTER the MCP_ROW_ID dedupe below. The raw
  // fetched length would over-count a re-page and hide a genuine shortfall
  // from `settlingDeficit`.
  distinct: number;
  // Lead ids carried by records that are NOT yet terminal. The wizard can
  // still re-match these, so a caller unioning in another source of lead ids
  // must not let them back in through the side door.
  pendingLeadIds: Set<string>;
  // Records the wizard is still working on. They are deliberately in NEITHER
  // bucket: `import-leads`'s reconciler can call an unresolved record an
  // `internal_error` because it only runs after the records settled, but a
  // status poll has no such guarantee. Calling a pending row "failed" is what
  // sends an agent back into a retry loop, so we count them instead.
  pending: number;
}

// Rows the import declares (summed `total_records`) minus the rows a snapshot
// actually returned. The import-level `processing.finished` flag can flip
// before every record is exposed, and a re-page mid-fetch can drop rows, so a
// snapshot that is short of the declared total is NOT final — the shortfall is
// still settling, not missing. Never let it read as "we saw everything".
export function settlingDeficit(declaredTotal: number, fetched: number): number {
  return Math.max(0, declaredTotal - fetched);
}

// Stateless reconciliation of a wizard's records into the import-result
// buckets. Unlike `reconcileOneChunk` in import-leads.ts this has no index of
// the caller's inputs, so it reports whatever the records themselves carry:
// `rowId` when the import went through this MCP (MCP_ROW_ID round-trips),
// `domain` when a LEAD_WEBSITE column or a matched lead website is present.
export function reconcileRecords(records: ImportRecordPayload[]): ReconciledRecords {
  const leads: ReconciledLead[] = [];
  const not_imported: ReconciledNotImported[] = [];
  const pendingLeadIds = new Set<string>();
  let pending = 0;
  let distinct = 0;
  const seenRowIds = new Set<string>();

  for (const rec of records) {
    const rowId = readCell(rec, MCP_ROW_ID_COLUMN) ?? undefined;
    // The wizard can return the same row across pages during a re-page; dedupe
    // on the synthetic id when we have one.
    if (rowId) {
      if (seenRowIds.has(rowId)) continue;
      seenRowIds.add(rowId);
    }
    distinct++;
    const websiteCell = readCell(rec, "LEAD_WEBSITE");
    const domain =
      normalizeDomain(websiteCell ?? "") ??
      normalizeDomain(rec.lead?.website ?? "") ??
      undefined;

    // `lead.id` can be populated while the record is still MATCHING /
    // IMPORTING — the wizard may yet re-match it. `isRecordTerminal` is this
    // module's own definition of settled (IMPORTED or NO_MATCH); honour it
    // before either bucket, so a mid-flight row is reported as pending rather
    // than as a final answer the caller acts on.
    if (!isRecordTerminal(rec)) {
      pending++;
      if (rec.lead?.id) pendingLeadIds.add(rec.lead.id);
      continue;
    }
    if (rec.lead?.id) {
      leads.push({
        ...(rowId ? { rowId } : {}),
        ...(domain ? { domain } : {}),
        leadId: rec.lead.id,
        name: rec.lead.name ?? null,
      });
      continue;
    }
    if (recordMatchType(rec) === "NO_MATCH") {
      not_imported.push({
        ...(rowId ? { rowId } : {}),
        ...(domain ? { domain } : {}),
        reason: domain && PUBLIC_MAILBOX_DOMAINS.has(domain) ? "no_match" : "uncrawled",
      });
      continue;
    }
    pending++;
  }

  return { leads, not_imported, pending, distinct, pendingLeadIds };
}
