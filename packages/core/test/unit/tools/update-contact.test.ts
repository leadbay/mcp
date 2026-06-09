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

describe("leadbay_update_contact", () => {
  it("happy path — edits via POST /contacts/{id}/update with snake_case body", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/contacts/c-1/update",
        status: 200,
        body: {
          id: "c-1",
          first_name: "Jane",
          last_name: "Doe",
          email: null,
          phone_number: null,
          linkedin_page: null,
          job_title: "SVP Engineering",
        },
      },
    ]);

    const result = await updateContact.execute(newClient(), {
      contact_id: "c-1",
      first_name: "Jane",
      last_name: "Doe",
      job_title: "SVP Engineering",
    });

    expect(result.updated).toBe(true);
    expect(result.contact_id).toBe("c-1");
    expect(result.contact.job_title).toBe("SVP Engineering");

    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].path).toBe("/1.5/contacts/c-1/update");
    const sent = JSON.parse(reqs[0].body as string);
    // first/last name are always sent (backend requires the full identity).
    expect(sent).toMatchObject({
      first_name: "Jane",
      last_name: "Doe",
      job_title: "SVP Engineering",
    });
  });

  it("propagates a 400 (partial/invalid body)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/contacts/c-2/update",
        status: 400,
        body: { error: { code: "bad_request", message: "invalid contact" } },
      },
    ]);

    await expect(
      updateContact.execute(newClient(), {
        contact_id: "c-2",
        first_name: "A",
        last_name: "B",
      }),
    ).rejects.toThrow();
  });

  it("is registered as a write tool", () => {
    expect(updateContact.write).toBe(true);
    expect(updateContact.name).toBe("leadbay_update_contact");
  });
});
