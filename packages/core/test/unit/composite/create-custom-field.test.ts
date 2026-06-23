import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { createCustomField } from "../../../src/composite/create-custom-field.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.test-token", "us");
}

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_create_custom_field", () => {
  it("creates an EXTERNAL_ID field and returns the import mapping value", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/crm/custom_fields", status: 200, body: [] },
      {
        method: "POST",
        path: "/1.5/crm/custom_fields",
        status: 200,
        body: {
          id: "8",
          name: "HubSpot Contact",
          type: "EXTERNAL_ID",
          config: {
            url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
          },
        },
      },
    ]);

    const out = await createCustomField.execute(newClient(), {
      name: "HubSpot Contact",
      type: "EXTERNAL_ID",
      config: {
        url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
      },
    });

    expect(out).toMatchObject({
      id: "8",
      name: "HubSpot Contact",
      type: "EXTERNAL_ID",
      mapping_value: "CUSTOM.8",
      existed: false,
    });
    const requests = getHttpRequests();
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /1.5/crm/custom_fields",
      "POST /1.5/crm/custom_fields",
    ]);
    expect(JSON.parse(requests[1].body ?? "{}")).toEqual({
      name: "HubSpot Contact",
      type: "EXTERNAL_ID",
      config: {
        url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
      },
    });
  });

  it("reuses an existing same-name field by default", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/crm/custom_fields",
        status: 200,
        body: [
          {
            id: "9",
            name: "HubSpot Contact",
            type: "EXTERNAL_ID",
            config: {
              url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
            },
          },
        ],
      },
    ]);

    const out = await createCustomField.execute(newClient(), {
      name: "hubspot contact",
      type: "EXTERNAL_ID",
      config: {
        url_template: "https://app.hubspot.com/contacts/123/record/0-1/{value}",
      },
    });

    expect(out).toMatchObject({
      id: "9",
      name: "HubSpot Contact",
      mapping_value: "CUSTOM.9",
      existed: true,
    });
    expect(getHttpRequests().map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /1.5/crm/custom_fields",
    ]);
  });

  it("rejects EXTERNAL_ID without a url_template containing {value}", async () => {
    await expect(
      createCustomField.execute(newClient(), {
        name: "HubSpot Contact",
        type: "EXTERNAL_ID",
        config: { url_template: "https://app.hubspot.com/contacts/123" },
      })
    ).rejects.toMatchObject({
      error: true,
      code: "CUSTOM_FIELD_EXTERNAL_ID_TEMPLATE_REQUIRED",
    });
    expect(getHttpRequests()).toEqual([]);
  });
});
