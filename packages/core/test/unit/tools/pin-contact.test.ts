import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pinContact } from "../../../src/tools/pin-contact.js";
import { unpinContact } from "../../../src/tools/unpin-contact.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_pin_contact", () => {
  it("happy path — pins via POST /contacts/{id}/pin", async () => {
    mockHttp([
      { method: "POST", path: "/1.5/contacts/c-1/pin", status: 204, body: "" },
    ]);

    const result = await pinContact.execute(newClient(), { contact_id: "c-1" });

    expect(result).toEqual({
      pinned: true,
      contact_id: "c-1",
      action: "pinned",
    });
    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].path).toBe("/1.5/contacts/c-1/pin");
  });

  it("propagates a 404", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/contacts/missing/pin",
        status: 404,
        body: { message: "not found" },
      },
    ]);
    await expect(
      pinContact.execute(newClient(), { contact_id: "missing" }),
    ).rejects.toThrow();
  });

  it("is registered as a write tool", () => {
    expect(pinContact.write).toBe(true);
    expect(pinContact.name).toBe("leadbay_pin_contact");
  });
});

describe("leadbay_unpin_contact", () => {
  it("happy path — unpins via POST /contacts/{id}/unpin", async () => {
    mockHttp([
      { method: "POST", path: "/1.5/contacts/c-2/unpin", status: 204, body: "" },
    ]);

    const result = await unpinContact.execute(newClient(), {
      contact_id: "c-2",
    });

    expect(result).toEqual({
      pinned: false,
      contact_id: "c-2",
      action: "unpinned",
    });
    const reqs = getHttpRequests();
    expect(reqs[0].path).toBe("/1.5/contacts/c-2/unpin");
  });

  it("is registered as a write tool", () => {
    expect(unpinContact.write).toBe(true);
    expect(unpinContact.name).toBe("leadbay_unpin_contact");
  });
});
