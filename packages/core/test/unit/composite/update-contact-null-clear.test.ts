import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { updateContact } from "../../../src/composite/update-contact.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_update_contact — null clears", () => {
  it("forwards null to clear a field (email/title) — backend accepts it", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/contacts/c-9/update",
        status: 200,
        body: {
          id: "c-9",
          first_name: "Null",
          last_name: "Clear",
          email: null,
          phone_number: null,
          linkedin_page: null,
          job_title: null,
        },
      },
    ]);

    const result = await updateContact.execute(newClient(), {
      contact_id: "c-9",
      first_name: "Null",
      last_name: "Clear",
      email: null,
      job_title: null,
    });

    expect(result.updated).toBe(true);

    const sent = JSON.parse(getHttpRequests()[0].body as string);
    // null is sent on the wire (the clear), not dropped.
    expect(sent).toHaveProperty("email", null);
    expect(sent).toHaveProperty("job_title", null);
    expect(sent.first_name).toBe("Null");
    expect(sent.last_name).toBe("Clear");
    // Fields the caller didn't mention are NOT sent (undefined is skipped).
    expect(sent).not.toHaveProperty("phone_number");
    expect(sent).not.toHaveProperty("linkedin_page");
  });

  it("schema declares nullable types for the optional update fields", () => {
    const props = (updateContact.inputSchema as any).properties;
    for (const f of ["job_title", "linkedin_page", "email", "phone_number"]) {
      expect(props[f].type).toEqual(["string", "null"]);
    }
  });
});
