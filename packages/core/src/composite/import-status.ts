import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, RequestMeta, FileImportPayloadV15 } from "../types.js";
import { isValidBulkId } from "../jobs/bulk-store.js";

import { leadbay_import_status as IMPORT_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
interface ImportStatusParams {
  handle_id?: string;
  importIds?: string[];
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
        description: "Legacy backend file-import ids to inspect directly.",
        items: { type: "string" },
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
        description: "Final import result when the handle has completed in this MCP instance.",
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
    let handleDryRun: boolean | undefined;

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
      handleDryRun = record.dry_run;
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
    return {
      status: failed ? "failed" : complete ? "complete" : "running",
      ...(handleId ? { handle_id: handleId } : {}),
      importIds,
      progress,
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
