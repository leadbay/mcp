import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { removeContact } from "../../../src/tools/remove-contact.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_remove_contact", () => {
  it("happy path — archives the contact via POST /contacts/{id}/archive", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/contacts/c-123/archive",
        status: 204,
        body: "",
      },
    ]);

    const result = await removeContact.execute(newClient(), {
      contact_id: "c-123",
    });

    expect(result).toEqual({
      archived: true,
      contact_id: "c-123",
      action: "archived",
    });

    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe("POST");
    // Keyed by the contact's own id — NOT nested under the lead.
    expect(reqs[0].path).toBe("/1.5/contacts/c-123/archive");
  });

  it("propagates a 404 (unknown contact id)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/contacts/missing/archive",
        status: 404,
        body: { message: "not found" },
      },
    ]);

    await expect(
      removeContact.execute(newClient(), { contact_id: "missing" }),
    ).rejects.toThrow();
  });

  it("is registered as a write tool", () => {
    expect(removeContact.write).toBe(true);
    expect(removeContact.name).toBe("leadbay_remove_contact");
  });
});
