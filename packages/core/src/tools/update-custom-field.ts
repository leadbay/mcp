import type { LeadbayClient } from "../client.js";
import type {
  CustomCrmFieldConfig,
  CustomCrmFieldKind,
  CustomFieldDef,
  Tool,
} from "../types.js";

import { leadbay_update_custom_field as UPDATE_CUSTOM_FIELD_DESCRIPTION } from "../tool-descriptions.generated.js";
import { sanitizeConfigForType } from "./_custom-field-config.js";

interface UpdateCustomFieldParams {
  id: string;
  name?: string;
  type?: CustomCrmFieldKind;
  config?: CustomCrmFieldConfig | null;
}

// Update an existing org CRM custom field — rename it and/or change its type +
// config. Wire: POST /crm/custom_fields/{id} with {name, type, config?}
// (returns 204; verified live). The backend replaces the row, so name AND type
// are sent together — we resolve the current definition first and merge the
// caller's partial change over it, so a rename-only call keeps the type and a
// retype-only call keeps the name.
export const updateCustomField: Tool<UpdateCustomFieldParams> = {
  name: "leadbay_update_custom_field",
  annotations: {
    title: "Update CRM custom field",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: UPDATE_CUSTOM_FIELD_DESCRIPTION,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "Custom field id to update (the numeric id from leadbay_list_mappable_fields, NOT the 'CUSTOM.<id>' mapping value).",
      },
      name: {
        type: "string",
        description: "New user-visible name. Omit to keep the current name.",
      },
      type: {
        type: "string",
        description:
          "New type: TEXT, NUMBER, PRICE, DATE, DATETIME, or EXTERNAL_ID. Omit to keep the current type.",
      },
      config: {
        type: ["object", "null"],
        description:
          "New type-specific config. EXTERNAL_ID requires {url_template:'https://.../{value}'}; PRICE requires {currency:'USD'}; DATE/DATETIME may set {format}. Omit to keep current config.",
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
      config: { type: ["object", "null"] },
      mapping_value: {
        type: "string",
        description: "Wire mapping value for import mappings, e.g. CUSTOM.123.",
      },
    },
    required: ["id", "name", "type", "mapping_value"],
  },
  execute: async (client: LeadbayClient, params: UpdateCustomFieldParams) => {
    const id = String(params.id ?? "").trim();
    if (!id) {
      throw client.makeError(
        "CUSTOM_FIELD_ID_REQUIRED",
        "id must be a non-empty string",
        "Pass the custom field id from leadbay_list_mappable_fields (the numeric id, not 'CUSTOM.<id>').",
        "POST /crm/custom_fields/{id}"
      );
    }

    if (params.name === undefined && params.type === undefined && params.config === undefined) {
      throw client.makeError(
        "CUSTOM_FIELD_NO_CHANGE",
        "no field to update — pass at least one of name, type, config",
        "Provide a new name and/or type (and config when the type needs it).",
        "POST /crm/custom_fields/{id}"
      );
    }

    // Resolve the current definition so a partial update preserves the rest.
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
        "POST /crm/custom_fields/{id}"
      );
    }

    const name = params.name !== undefined ? params.name.trim() : current.name;
    if (!name) {
      throw client.makeError(
        "CUSTOM_FIELD_NAME_REQUIRED",
        "name must be a non-empty string",
        "Pass a user-visible custom field name, or omit name to keep the current one.",
        "POST /crm/custom_fields/{id}"
      );
    }
    const type = params.type !== undefined ? params.type : current.type;
    const rawConfig =
      params.config !== undefined ? params.config : (current.config ?? null);

    // Narrow config to exactly the key(s) the target type accepts (also parses
    // a stringified config — LLMs often pass nested JSON as a string). The
    // backend deserializer is strict: extra keys (e.g. a stale `format` left
    // from the previous type) cause a 500, and a string config drops the
    // required key. Critical on a type CHANGE, where current.config may carry
    // keys the new type rejects.
    const config = sanitizeConfigForType(type, rawConfig);

    if (type === "EXTERNAL_ID") {
      const urlTemplate = config?.url_template;
      if (!urlTemplate || !urlTemplate.includes("{value}")) {
        throw client.makeError(
          "CUSTOM_FIELD_EXTERNAL_ID_TEMPLATE_REQUIRED",
          "EXTERNAL_ID custom fields require config.url_template containing {value}",
          "Use a URL template like https://app.hubspot.com/contacts/<portal-id>/record/0-1/{value}.",
          "POST /crm/custom_fields/{id}"
        );
      }
    }

    const body = {
      name,
      type,
      ...(config ? { config } : {}),
    };
    // 204 No Content on success — no response body to parse.
    await client.requestVoid("POST", `/crm/custom_fields/${id}`, body);

    return {
      id,
      name,
      type,
      config: config ?? null,
      mapping_value: `CUSTOM.${id}`,
    };
  },
};
