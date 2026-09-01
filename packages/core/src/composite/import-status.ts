import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  RequestMeta,
  FileImportPayloadV15,
  ImportLeadsResponse,
  ImportRecordPayload,
  PaginatedResponse,
} from "../types.js";
import { isValidBulkId } from "../jobs/bulk-store.js";
import {
  reconcileRecords,
  settlingDeficit,
  type ReconciledLead,
  type ReconciledNotImported,
} from "./_import-records.js";

import { leadbay_import_status as IMPORT_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface ImportStatusParams {
  handle_id?: string;
  importIds?: string[];
  dry_run?: boolean;
}

interface ImportStatusResult {
  status: "running" | "complete" | "failed";
  handle_id?: string;
  importIds: string[];
  progress: {
    phase: string;
    records_processed: number;
    records_total: number;
  };
  result?: {
    leads: unknown[];
    not_imported: unknown[];
    importIds: string[];
    // Only on the records-reconciled path: rows the wizard is still working
    // on. They are in NEITHER bucket — a pending row is not a failed row.
    still_settling?: number;
  };
  error?: string;
  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

function summarizeImports(
  imports: FileImportPayloadV15[],
  dryRun?: boolean
): ImportStatusResult["progress"] {
  let recordsTotal = 0;
  let recordsProcessed = 0;
  let hasPreprocess = false;
  let hasProcess = false;
  let hasFailed = false;
  for (const imp of imports) {
    recordsTotal += Number(imp.total_records ?? 0);
    recordsProcessed += Number(imp.imported_records ?? 0);
    if (!imp.pre_processing?.finished) {
      hasPreprocess = true;
      continue;
    }
    if (imp.pre_processing?.error) {
      hasFailed = true;
      continue;
    }
    if (dryRun === true) {
      continue;
    }
    if (!imp.processing?.finished) {
      if (dryRun === false || imp.processing != null) hasProcess = true;
      continue;
    }
    if (imp.processing?.error) {
      hasFailed = true;
    }
  }
  const phase = hasFailed
    ? "failed"
    : hasPreprocess
    ? "preprocess"
    : hasProcess
    ? "process"
    : imports.length > 0
    ? "complete"
    : "queued";
  return {
    phase,
    records_processed: recordsProcessed,
    records_total: recordsTotal,
  };
}

// Bound the records fan-out. MCP-created imports are chunked at 100 rows, but
// `importIds` can also name a wizard row created in the web UI with an
// arbitrary file behind it. Stop reading rather than paginate forever; the
// caller still gets status + progress, just no reconciled leads.
const RECORDS_PAGE_SIZE = 100;
const RECORDS_MAX_PAGES = 20;

// product#4007: `leadbay_import_status` used to return progress only on the
// `importIds[]` path, so an import that timed out mid-poll could be observed
// as "complete" but never yielded its leadIds — and the agent's only way to
// get them was to re-run the whole import. The wizard already holds the
// mapping (MCP_ROW_ID round-trips through the synthesized CSV), so read it.
// Raised when the wizard answers `400 in_progress`. Probed on us-staging
// 2026-09-01: an import whose mappings have NOT been committed answers that on
// BOTH /leads and /records, and its row is byte-identical to a finished dry
// run — total_records 0, pre_processing.finished true, `processing` absent.
// So the row alone cannot say whether an import is done; the endpoint can.
class ImportNotReady extends Error {}

function isInProgress(err: any): boolean {
  return /in_progress/i.test(String(err?.message ?? ""));
}

async function fetchReconciledRecords(
  client: LeadbayClient,
  importIds: string[],
  declaredTotal: number,
  ctx: ToolContext | undefined
): Promise<{
  leads: ReconciledLead[];
  not_imported: ReconciledNotImported[];
  still_settling: number;
} | null> {
  // GET /imports/{id}/leads is the canonical set of leads an import touched —
  // matched-existing AND newly-created — per the imports-mcp wrapper spec, and
  // it is what import-and-qualify already trusts (import-and-qualify.ts).
  // Records only annotate those ids with rowId / domain / name, so a lead the
  // wizard created without attaching it to a visible record row is still
  // reported instead of silently dropped.
  const canonicalLeadIds = new Set<string>();
  for (const importId of importIds) {
    try {
      const res = await client.request<ImportLeadsResponse>(
        "GET",
        `/imports/${importId}/leads`
      );
      for (const id of res?.lead_ids ?? []) canonicalLeadIds.add(id);
    } catch (err: any) {
      if (isInProgress(err)) throw new ImportNotReady();
      // 404 is the one benign case: a backend predating the endpoint. Anything
      // else (500, auth, network) means the canonical set is unknown, and a
      // records-only `result` would silently omit whatever /leads would have
      // added. Fail the reconciliation instead — the caller still gets status.
      if (err?.code !== "NOT_FOUND" && err?._meta?.http_status !== 404) throw err;
      ctx?.logger?.warn?.(
        `import-status: /imports/${importId}/leads not available on this backend (404) — using records only`
      );
    }
  }

  const all: ImportRecordPayload[] = [];
  for (const importId of importIds) {
    for (let page = 0; page < RECORDS_MAX_PAGES; page++) {
      const qs =
        `count=${RECORDS_PAGE_SIZE}&page=${page}` +
        `&automatic_match=true&manual_match=true&no_match=true` +
        `&matching=true&importing=true&imported=true`;
      let res: PaginatedResponse<ImportRecordPayload>;
      try {
        res = await client.request<PaginatedResponse<ImportRecordPayload>>(
          "GET",
          `/imports/${importId}/records?${qs}`
        );
      } catch (err: any) {
        if (isInProgress(err)) throw new ImportNotReady();
        throw err;
      }
      all.push(...res.items);
      const totalPages = res.pagination.pages ?? 0;
      if (page + 1 >= totalPages) break;
      if (page + 1 === RECORDS_MAX_PAGES) {
        // More pages exist than we will read. Returning a partial `leads[]`
        // would read as "these are all of them" — say nothing instead.
        ctx?.logger?.warn?.(
          `import-status: importId=${importId} has >${RECORDS_MAX_PAGES} record pages; skipping reconciliation`
        );
        return null;
      }
    }
  }
  const { leads, not_imported, pending, distinct, pendingLeadIds } =
    reconcileRecords(all);

  // Append the canonical ids no record row exposed. Records-mode imports
  // deliberately let several rows target one lead (separate contacts on the
  // same company), so keep EVERY reconciled row — keying a map by leadId here
  // would collapse them and lose the per-row rowId/domain the caller needs.
  const deficit = settlingDeficit(declaredTotal, distinct);
  const seenLeadIds = new Set(leads.map((l) => l.leadId));
  const merged = [...leads];
  // Only publish an id no record vouched for when the snapshot is COMPLETE.
  // `pendingLeadIds` can only speak for rows we actually fetched, so while
  // rows are missing an unvouched canonical id might belong to one of them and
  // still be MATCHING — publishing it would hand downstream qualification or
  // outreach a lead the wizard may yet re-match. When rows are missing the
  // caller is told to poll again anyway.
  if (deficit === 0) {
    for (const id of canonicalLeadIds) {
      if (seenLeadIds.has(id)) continue;
      // A lead id belonging to a record that is still MATCHING / IMPORTING is
      // not an answer yet. `reconcileRecords` deliberately held it back;
      // adding it here as an id-only lead would undo that.
      if (pendingLeadIds.has(id)) continue;
      merged.push({ leadId: id, name: null });
    }
  }

  return {
    leads: merged,
    not_imported,
    // A snapshot short of the declared row count is not final — see
    // `settlingDeficit`. Measured on DISTINCT rows: `all.length` counts a
    // re-paged row twice and would mask a genuine shortfall.
    still_settling: pending + deficit,
  };
}

export const importStatus: Tool<ImportStatusParams, ImportStatusResult> = {
  name: "leadbay_import_status",
  annotations: {
    title: "Poll import status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: IMPORT_STATUS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      handle_id: {
        type: "string",
        description: "UUIDv4 handle returned by leadbay_import_leads when wait_for_completion=false.",
      },
      importIds: {
        type: "array",
        description:
          "Backend file-import ids to inspect directly — from a completed import's `importIds`, or from a `{status:'running', timed_out:true}` result.",
        items: { type: "string" },
      },
      dry_run: {
        type: "boolean",
        description:
          "Pass true when the importIds came from a dry run. A dry run and an import still committing its mappings look identical on the wire, so without this the tool reports the dry run as still running rather than risk rendering it as a real import.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "running, complete, or failed." },
      handle_id: { type: "string" },
      importIds: { type: "array", items: { type: "string" } },
      progress: { type: "object" },
      result: {
        type: "object",
        description:
          "Final import result: {leads, not_imported, importIds, still_settling?}. Present when a handle_id resolves a completed run in this MCP instance, OR when the importIds[] path finds every import complete and reconciles the wizard's records.",
      },
      error: { type: "string" },
      region: { type: "string" },
      _meta: { type: "object" },
    },
    required: ["status", "importIds", "progress", "region", "_meta"],
  },
  execute: async (
    client: LeadbayClient,
    params: ImportStatusParams,
    ctx?: ToolContext
  ): Promise<ImportStatusResult> => {
    let handleId = params.handle_id;
    let importIds = params.importIds ?? [];
    // A dry run and an import parked mid-commit are indistinguishable on the
    // wire (probed us-staging 2026-09-01), so the caller has to tell us. The
    // running result from a timed-out `leadbay_import_leads` carries
    // `dry_run`; pass it straight back here.
    let handleDryRun: boolean | undefined = params.dry_run;

    if (handleId) {
      if (!isValidBulkId(handleId)) {
        throw client.makeError(
          "BULK_INVALID_ID",
          "handle_id is not a valid UUIDv4",
          "Pass the handle_id returned by leadbay_import_leads verbatim.",
          ""
        );
      }
      if (!ctx?.bulkTracker) {
        throw client.makeError(
          "BULK_TRACKER_UNAVAILABLE",
          "No BulkTracker configured on this MCP instance",
          "leadbay_import_status needs a BulkTracker to resolve handle_id. Pass importIds[] directly as a fallback.",
          ""
        );
      }
      const record = await ctx.bulkTracker.getImport(handleId);
      if (!record) {
        const any = await ctx.bulkTracker.get(handleId);
        if (any && any.kind !== "import") {
          throw client.makeError(
            "BULK_WRONG_KIND",
            "This handle was not created by leadbay_import_leads",
            "Use leadbay_qualify_status for qualify ids or leadbay_bulk_enrich_status for enrich ids.",
            ""
          );
        }
        throw client.makeError(
          "BULK_NOT_FOUND",
          "No import record for that handle_id",
          "It may have expired (30-day TTL) or the MCP process was restarted without persistence.",
          ""
        );
      }
      importIds = record.import_ids;
      handleDryRun = record.dry_run ?? handleDryRun;
      if (record.status === "complete" && record.result) {
        return {
          status: "complete",
          handle_id: handleId,
          importIds,
          progress: record.progress ?? {
            phase: "complete",
            records_processed: record.records_total,
            records_total: record.records_total,
          },
          result: record.result,
          region: client.region,
          _meta: client.lastMeta ?? {
            region: client.region,
            endpoint: "bulk-store",
            latency_ms: null,
            retry_after: null,
          },
        };
      }
      if (record.status === "failed") {
        return {
          status: "failed",
          handle_id: handleId,
          importIds,
          progress: record.progress ?? {
            phase: "failed",
            records_processed: 0,
            records_total: record.records_total,
          },
          error: record.error ?? "import failed",
          region: client.region,
          _meta: client.lastMeta ?? {
            region: client.region,
            endpoint: "bulk-store",
            latency_ms: null,
            retry_after: null,
          },
        };
      }
      if (importIds.length === 0) {
        return {
          status: "running",
          handle_id: handleId,
          importIds,
          progress: record.progress ?? {
            phase: "queued",
            records_processed: 0,
            records_total: record.records_total,
          },
          region: client.region,
          _meta: client.lastMeta ?? {
            region: client.region,
            endpoint: "bulk-store",
            latency_ms: null,
            retry_after: null,
          },
        };
      }
    }

    // The same id passed twice would double-fetch it AND double-count its
    // declared rows against a record set that dedupes, pinning
    // `still_settling` above zero forever.
    importIds = [...new Set(importIds)];

    if (importIds.length === 0) {
      throw client.makeError(
        "IMPORT_STATUS_INPUT_REQUIRED",
        "Pass either handle_id or importIds[]",
        "Call leadbay_import_leads with wait_for_completion=false first, then pass its handle_id.",
        ""
      );
    }

    const imports = await Promise.all(
      importIds.map((id) =>
        client.request<FileImportPayloadV15>("GET", `/imports/${id}`)
      )
    );
    const progress = summarizeImports(imports, handleDryRun);
    const failed = imports.find(
      (i) => i.pre_processing?.error || i.processing?.error
    );
    const complete = imports.every((i) => {
      if (i.pre_processing?.error || i.processing?.error) return false;
      if (handleDryRun === true) return Boolean(i.pre_processing?.finished);
      if (handleDryRun === false) return Boolean(i.processing?.finished);
      return Boolean(i.processing?.finished || (i.pre_processing?.finished && !i.processing));
    });
    // A complete, non-dry-run import can hand back the leadIds the caller
    // came for — without any client-side state, which is what makes this
    // work on the hosted MCP (no BulkTracker there). Only on the terminal
    // branch: polling records mid-flight would report pending rows.
    let reconciled: Awaited<ReturnType<typeof fetchReconciledRecords>> = null;
    // The wizard row cannot distinguish "finished" from "mappings never
    // committed": a real import that timed out during preprocess and a
    // completed dry run have identical payloads. The endpoints CAN — they
    // answer `400 in_progress` until the import is genuinely done. So when the
    // row looks complete, ask, and demote to `running` if the answer is no.
    // Getting this wrong reports `complete` with no leads and the agent stops
    // polling — the failure this whole change exists to prevent.
    let notReady = false;
    const declaredTotal = imports.reduce(
      (n, i) => n + Number(i.total_records ?? 0),
      0
    );
    if (!failed && complete && handleDryRun !== true && importIds.length > 0) {
      try {
        reconciled = await fetchReconciledRecords(
          client,
          importIds,
          declaredTotal,
          ctx
        );
      } catch (err: any) {
        if (err instanceof ImportNotReady) {
          notReady = true;
          ctx?.logger?.info?.(
            `import-status: wizard reports in_progress; mappings not committed yet — reporting running`
          );
        } else {
          // Status is the answer the caller asked for; leads are the bonus.
          // Never turn a readable status into an error over the bonus.
          ctx?.logger?.warn?.(
            `import-status: records reconciliation failed (${err?.code ?? err?.message ?? "unknown"}); returning status only`
          );
        }
      }
    }
    const settled = complete && !notReady;

    return {
      status: failed ? "failed" : settled ? "complete" : "running",
      ...(handleId ? { handle_id: handleId } : {}),
      importIds,
      progress: notReady
        ? { ...progress, phase: "committing" }
        : progress,
      ...(reconciled
        ? {
            result: {
              leads: reconciled.leads,
              not_imported: reconciled.not_imported,
              importIds,
              ...(reconciled.still_settling > 0
                ? { still_settling: reconciled.still_settling }
                : {}),
            },
          }
        : {}),
      ...(failed
        ? {
            error:
              failed.pre_processing?.error ??
              failed.processing?.error ??
              "import failed",
          }
        : {}),
      region: client.region,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "GET /imports/<id>",
        latency_ms: null,
        retry_after: null,
      },
    };
  },
};
