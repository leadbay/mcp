import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  LeadPayload,
  LeadCustomFieldEntry,
  CustomFieldDef,
} from "../types.js";

import { leadbay_get_lead_custom_fields as GET_LEAD_CUSTOM_FIELDS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { reportLeadInteractions } from "../interactions.js";

interface GetLeadCustomFieldsParams {
  leadId: string;
  lensId?: number;
}

// A flattened, human-readable custom-field row for one lead.
interface CustomFieldValueRow {
  id: string;
  name: string | null;
  type: string | null;
  value: string | null;
}

// Retrieve the CRM custom-field VALUES stored on a single lead.
//
// The lead-detail payload already embeds each field's definition under
// `custom_fields[].field` (verified live), so this is a pass-through + flatten
// — NO /crm/custom_fields join is needed on the happy path. The catalog is
// fetched ONLY as a fallback to name entries that arrive without an embedded
// `field` object (defensive; not observed in practice).
export const getLeadCustomFields: Tool<GetLeadCustomFieldsParams> = {
  name: "leadbay_get_lead_custom_fields",
  annotations: {
    title: "Read a lead's custom-field values",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: GET_LEAD_CUSTOM_FIELDS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      lensId: {
        type: "number",
        description:
          "Lens id (escape hatch — normally omit; auto-resolves to the active lens)",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      // Layout pointer, attached by the MCP server. The full block moved to
      // render-blocks.generated.ts via promptforge's {{render}} marker.
      render: {
        type: "object",
        description:
          "Layout for this result. `recipe` is the one-line version; `guide` is the tool name to pass to leadbay_render_guide for the full algorithm.",
        properties: {
          recipe: { type: "string" },
          guide: { type: "string" },
        },
      },
      lead_id: { type: "string" },
      custom_fields: {
        type: "array",
        description:
          "Custom-field VALUES on this lead. Each: {id, name, type, value}. Empty when the org has no custom fields or none are set on this lead.",
        items: { type: "object" },
      },
      count: { type: "number" },
      region: { type: "string" },
      hint: {
        type: "string",
        description:
          "Operator note — empty-state guidance, or a degradation note when the lead fetch returned entries without embedded definitions.",
      },
      _meta: { type: "object" },
    },
    required: ["custom_fields", "lead_id"],
  },
  execute: async (
    client: LeadbayClient,
    params: GetLeadCustomFieldsParams,
    ctx?: ToolContext
  ) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    // Mark the lead as seen+clicked in the user's lens (parity with
    // get-lead-profile / research-lead-by-id). Fire-and-forget: a failure
    // here must NOT break the field read.
    reportLeadInteractions(
      client,
      lensId,
      [params.leadId],
      ["LEAD_SEEN", "LEAD_CLICKED"],
      ctx?.logger
    );

    const lead = await client.request<LeadPayload>(
      "GET",
      `/lenses/${lensId}/leads/${params.leadId}`
    );

    const entries: LeadCustomFieldEntry[] = lead.custom_fields ?? [];

    // Happy path: every entry is self-describing. Only when an entry lacks an
    // embedded `field` do we reach for the catalog to name it.
    const needsCatalog = entries.some((e) => !e?.field?.name);
    let catalog: CustomFieldDef[] | null = null;
    if (needsCatalog) {
      try {
        catalog = await client.request<CustomFieldDef[]>(
          "GET",
          "/crm/custom_fields"
        );
      } catch (err: any) {
        ctx?.logger?.warn?.(
          `get_lead_custom_fields: catalog fallback failed: ${err?.message ?? err?.code ?? err}`
        );
      }
    }
    const byId = new Map<string, CustomFieldDef>(
      (catalog ?? []).map((f) => [f.id, f])
    );

    const rows: CustomFieldValueRow[] = entries.map((e) => {
      // Self-describing entry is the norm; fall back to the catalog only when
      // `field` is absent but a bare id is present.
      const bareId = (e as { id?: string }).id;
      const id = e.field?.id ?? bareId ?? "";
      const def = e.field ? undefined : byId.get(String(id));
      return {
        id: String(id),
        name: e.field?.name ?? def?.name ?? null,
        type: e.field?.type ?? def?.type ?? null,
        value: e.value ?? null,
      };
    });

    let hint: string | undefined;
    if (rows.length === 0) {
      hint =
        "This lead has no custom-field values. The org may have no custom fields defined — see leadbay_list_mappable_fields for the catalog, or set values via import (map a column to CUSTOM.<id>).";
    } else if (needsCatalog && rows.some((r) => r.name === null)) {
      hint =
        "Some custom fields could not be named (the lead payload omitted definitions and the catalog fetch failed). Retry, or check leadbay_list_mappable_fields.";
    }

    return {
        lead_id: params.leadId,
        custom_fields: rows,
        count: rows.length,
        region: client.region,
        ...(hint ? { hint } : {}),
      };
  },
};
