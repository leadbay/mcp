import type { LeadbayClient } from "../client.js";
import type {
  CustomCrmFieldConfig,
  CustomCrmFieldKind,
  CustomFieldDef,
  Tool,
} from "../types.js";

import { leadbay_create_custom_field as CREATE_CUSTOM_FIELD_DESCRIPTION } from "../tool-descriptions.generated.js";
interface CreateCustomFieldParams {
  name: string;
  type?: CustomCrmFieldKind;
  config?: CustomCrmFieldConfig | null;
  if_not_exists?: boolean;
}

export const createCustomField: Tool<CreateCustomFieldParams> = {
  name: "leadbay_create_custom_field",
  annotations: {
    title: "Create CRM custom field",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: CREATE_CUSTOM_FIELD_DESCRIPTION,
  write: true,
  version: "0.6.4",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "User-visible custom field name, e.g. 'HubSpot Contact'.",
      },
      type: {
        type: "string",
        description:
          "Custom field type: TEXT, NUMBER, PRICE, DATE, DATETIME, or EXTERNAL_ID. Defaults to TEXT.",
      },
      config: {
        type: ["object", "null"],
        description:
          "Type-specific config. EXTERNAL_ID requires {url_template:'https://.../{value}'}; PRICE requires {currency:'USD'}; DATE/DATETIME may set {format}.",
      },
      if_not_exists: {
        type: "boolean",
        description:
          "Default true. If a custom field with the same name already exists, return it instead of creating a duplicate.",
      },
    },
    required: ["name"],
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
        description: "Wire mapping value to use in import mappings, e.g. CUSTOM.123.",
      },
      existed: {
        type: "boolean",
        description: "True when if_not_exists reused an existing custom field.",
      },
    },
    required: ["id", "name", "type", "mapping_value", "existed"],
  },
  execute: async (
    client: LeadbayClient,
    params: CreateCustomFieldParams
  ) => {
    const name = params.name?.trim();
    if (!name) {
      throw client.makeError(
        "CUSTOM_FIELD_NAME_REQUIRED",
        "name must be a non-empty string",
        "Pass a user-visible custom field name, e.g. 'HubSpot Contact'.",
        "POST /crm/custom_fields"
      );
    }

    const type = params.type ?? "TEXT";
    const config = params.config ?? null;

    if (type === "EXTERNAL_ID") {
      const urlTemplate = config?.url_template ?? config?.urlTemplate;
      if (!urlTemplate || !urlTemplate.includes("{value}")) {
        throw client.makeError(
          "CUSTOM_FIELD_EXTERNAL_ID_TEMPLATE_REQUIRED",
          "EXTERNAL_ID custom fields require config.url_template containing {value}",
          "Use a URL template like https://app.hubspot.com/contacts/<portal-id>/record/0-1/{value}.",
          "POST /crm/custom_fields"
        );
      }
    }

    if (params.if_not_exists ?? true) {
      const existing = await client.request<CustomFieldDef[]>(
        "GET",
        "/crm/custom_fields"
      );
      const found = (existing ?? []).find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (found) {
        return {
          ...found,
          mapping_value: `CUSTOM.${found.id}`,
          existed: true,
        };
      }
    }

    const body = {
      name,
      type,
      ...(config ? { config } : {}),
    };
    const created = await client.request<CustomFieldDef>(
      "POST",
      "/crm/custom_fields",
      body
    );

    return {
      ...created,
      mapping_value: `CUSTOM.${created.id}`,
      existed: false,
    };
  },
};
