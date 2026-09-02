/**
 * The generic 404 hint sent agents into a retry loop.
 *
 * `POST /contacts/{id}/pin` resolves through org_contacts only, so a
 * `source: "paid"` candidate id answers 404 forever. The client's shared
 * 404 handler (client.ts) attaches `hint: "Verify the ID is correct"`, which
 * on this endpoint is false: the id is correct, it is the wrong namespace.
 * An agent that reads "verify the id" looks the id up again, gets the same
 * one back, and calls again.
 *
 * That is the observed production behaviour: 43 of 48 leadbay_pin_contact
 * calls in the 180 days to 2026-09-02 were this 404, arriving in bursts of
 * up to 10 within 13 seconds, from a single scheduled agent.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pinContact, NOT_PINNABLE_HINT } from "../../../src/tools/pin-contact.js";
import { unpinContact } from "../../../src/tools/unpin-contact.js";

const BASE = "https://api-us.leadbay.app";
const PAID = "paid-candidate-id";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const notFound = (verb: "pin" | "unpin") => [
  {
    method: "POST" as const,
    path: `/1.6/contacts/${PAID}/${verb}`,
    status: 404,
    body: { message: "contact not found" },
  },
];

describe("pin/unpin — the 404 hint names the real cause", () => {
  it("pin replaces the generic hint and tells the agent not to retry", async () => {
    mockHttp(notFound("pin"));

    const err: any = await pinContact
      .execute(newClient(), { contact_id: PAID })
      .then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.code).toBe("NOT_FOUND");
    expect(err.hint).toBe(NOT_PINNABLE_HINT);
    expect(err.hint).not.toContain("Verify the ID is correct");
    expect(err.hint).toContain("do NOT retry");
    expect(err.hint).toContain('source: "org"');
    // The backend message and the request context survive the rewrite.
    expect(err.message).toContain("contact not found");
    expect(err._meta?.endpoint).toContain(`/contacts/${PAID}/pin`);
  });

  it("unpin answers a 404 the same way", async () => {
    mockHttp(notFound("unpin"));

    const err: any = await unpinContact
      .execute(newClient(), { contact_id: PAID })
      .then(() => null, (e) => e);

    expect(err.code).toBe("NOT_FOUND");
    expect(err.hint).toBe(NOT_PINNABLE_HINT);
  });

  it("the hint names the tools that actually make the person pinnable", () => {
    expect(NOT_PINNABLE_HINT).toContain("leadbay_enrich_titles");
    expect(NOT_PINNABLE_HINT).toContain("leadbay_add_contact");
    // The second half of the misconception behind the production failures:
    // the agent pinned in order to steer enrichment, which pinning never did.
    expect(NOT_PINNABLE_HINT).toContain("job title");
  });

  it("a non-404 failure is passed through untouched", async () => {
    mockHttp([
      {
        method: "POST",
        path: `/1.6/contacts/${PAID}/pin`,
        status: 500,
        body: { message: "boom" },
      },
    ]);

    const err: any = await pinContact
      .execute(newClient(), { contact_id: PAID })
      .then(() => null, (e) => e);

    expect(err.code).not.toBe("NOT_FOUND");
    expect(err.hint).not.toBe(NOT_PINNABLE_HINT);
  });

  it("a successful pin still makes exactly one request and returns the plain result", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/contacts/org-1/pin", status: 204, body: "" },
    ]);

    const result = await pinContact.execute(newClient(), { contact_id: "org-1" });

    expect(result).toEqual({ pinned: true, contact_id: "org-1", action: "pinned" });
    expect(getHttpRequests()).toHaveLength(1);
  });
});
