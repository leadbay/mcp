import type { LeadbayClient } from "../client.js";
import type { CustomFieldDef, Tool } from "../types.js";

import { leadbay_delete_custom_field as DELETE_CUSTOM_FIELD_DESCRIPTION } from "../tool-descriptions.generated.js";

interface DeleteCustomFieldParams {
  id: string;
  confirm?: boolean;
}

// Delete an org CRM custom field. Wire: DELETE /crm/custom_fields/{id}
// (returns 204; verified live). DESTRUCTIVE — removing the field drops its
// values from every lead and breaks any import mapping that targets
// CUSTOM.<id>. Requires an explicit `confirm: true` so an accidental call
// can't wipe data.
export const deleteCustomField: Tool<DeleteCustomFieldParams> = {
  name: "leadbay_delete_custom_field",
  annotations: {
    title: "Delete CRM custom field",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: DELETE_CUSTOM_FIELD_DESCRIPTION,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "Custom field id to delete (the numeric id from leadbay_list_mappable_fields, NOT the 'CUSTOM.<id>' mapping value).",
      },
      confirm: {
        type: "boolean",
        description:
          "Must be true to actually delete. Without it the tool returns the field that WOULD be deleted and does nothing — a safety gate, because deletion drops the field's values from every lead.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      type: { type: "string" },
      deleted: {
        type: "boolean",
        description: "True when the field was deleted; false when confirm was not set.",
      },
      hint: {
        type: "string",
        description: "Guidance — present when confirm was missing (re-call with confirm:true).",
      },
    },
    required: ["id", "deleted"],
  },
  execute: async (client: LeadbayClient, params: DeleteCustomFieldParams) => {
    const id = String(params.id ?? "").trim();
    if (!id) {
      throw client.makeError(
        "CUSTOM_FIELD_ID_REQUIRED",
        "id must be a non-empty string",
        "Pass the custom field id from leadbay_list_mappable_fields (the numeric id, not 'CUSTOM.<id>').",
        "DELETE /crm/custom_fields/{id}"
      );
    }

    // Resolve the field first so the response (and the confirm preview) names
    // what is being removed, and so we 404 cleanly on a bad id.
    const catalog = await client.request<CustomFieldDef[]>(
      "GET",
      "/crm/custom_fields"
    );
    const current = (catalog ?? []).find((f) => String(f.id) === id);
    if (!current) {
      throw client.makeError(
        "CUSTOM_FIELD_NOT_FOUND",
        `no custom field with id ${id} on this org`,
        "Call leadbay_list_mappable_fields to see the available custom fields and their ids.",
        "DELETE /crm/custom_fields/{id}"
      );
    }

    if (params.confirm !== true) {
      return {
        id,
        name: current.name,
        type: current.type,
        deleted: false,
        hint: `Deleting "${current.name}" removes its values from every lead and breaks any import mapping using CUSTOM.${id}. Re-call with confirm:true to proceed.`,
      };
    }

    // 204 No Content on success.
    await client.requestVoid("DELETE", `/crm/custom_fields/${id}`);

    return {
      id,
      name: current.name,
      type: current.type,
      deleted: true,
    };
  },
};
