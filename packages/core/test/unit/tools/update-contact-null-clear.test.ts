import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { updateContact } from "../../../src/tools/update-contact.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_update_contact — null clears", () => {
  it("clearing a field forwards null on /update — with the whole record supplied (product#4046)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/contacts/c-9/update",
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

    // An erase rewrites the record, so every optional field has to be stated.
    // Before product#4046 this call omitted phone_number and linkedin_page and
    // silently deleted them; now they must be named to be kept or cleared.
    const result = await updateContact.execute(newClient(), {
      contact_id: "c-9",
      first_name: "Null",
      last_name: "Clear",
      email: null,
      job_title: null,
      phone_number: null,
      linkedin_page: null,
    });

    expect(result.updated).toBe(true);

    const sent = JSON.parse(getHttpRequests()[0].body as string);
    // null is sent on the wire (the clear), not dropped.
    expect(sent).toHaveProperty("email", null);
    expect(sent).toHaveProperty("job_title", null);
    expect(sent.first_name).toBe("Null");
    expect(sent.last_name).toBe("Clear");
    // Every field is stated, because /update writes all of them.
    expect(sent).toHaveProperty("phone_number", null);
    expect(sent).toHaveProperty("linkedin_page", null);
  });

  it("schema declares nullable types for the optional update fields", () => {
    const props = (updateContact.inputSchema as any).properties;
    for (const f of ["job_title", "linkedin_page", "email", "phone_number"]) {
      expect(props[f].type).toEqual(["string", "null"]);
    }
  });
});
