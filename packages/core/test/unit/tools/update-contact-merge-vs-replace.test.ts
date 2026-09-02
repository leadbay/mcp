/**
 * product#4046 — editing one field on a contact used to erase the others.
 *
 * `POST /contacts/{id}/update` writes every column (`forceUpdateIfNullOrEmpty
 * = true`), so a field absent from the body was deleted and the call still
 * returned `updated: true`. Reproduced on production: sending a contact's own
 * current name + job title, changing nothing, deleted that contact's email and
 * the lead stopped being contactable.
 *
 * The backend already had the safe reading on `/merge`
 * (`forceUpdateIfNullOrEmpty = false`, which skips null/empty fields). These
 * pin which route each intent takes, because the whole fix is that choice.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { updateContact } from "../../../src/tools/update-contact.js";

const BASE = "https://api-us.leadbay.app";
const ID = "6837c37e-4371-41e8-8f48-bc0d1babbac0";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ECHO = { id: ID, first_name: "BARBE", last_name: "", job_title: "CEO" };

beforeEach(() => resetHttpMock());

describe("product#4046 — an omitted field is kept, an erase is explicit", () => {
  it("changing one field goes to /merge, so the others survive", async () => {
    mockHttp([{ method: "POST", path: `/1.6/contacts/${ID}/merge`, status: 200, body: ECHO }]);

    const r: any = await updateContact.execute(newClient(), {
      contact_id: ID, first_name: "BARBE", last_name: "", job_title: "CEO",
    });

    // The route IS the fix — /update here would have deleted the email.
    const req = getHttpRequests().at(-1)!;
    expect(req.path).toBe(`/1.6/contacts/${ID}/merge`);
    // And we must not invent values for what the caller left out.
    const sent = JSON.parse(req.body!);
    expect(sent).not.toHaveProperty("email");
    expect(sent).not.toHaveProperty("phone_number");
    expect(r.mode).toBe("merge");
    expect(r.preserved).toEqual(expect.arrayContaining(["email", "phone_number", "linkedin_page"]));
    expect(r.cleared).toEqual([]);
  });

  it("erasing a field with the full record goes to /update and reports it", async () => {
    mockHttp([{ method: "POST", path: `/1.6/contacts/${ID}/update`, status: 200, body: ECHO }]);

    const r: any = await updateContact.execute(newClient(), {
      contact_id: ID, first_name: "BARBE", last_name: "",
      job_title: "CEO", email: null, phone_number: "+33100000000", linkedin_page: null,
    });

    expect(getHttpRequests().at(-1)!.path).toBe(`/1.6/contacts/${ID}/update`);
    expect(r.mode).toBe("replace");
    expect([...r.cleared].sort()).toEqual(["email", "linkedin_page"]);
    expect(r.preserved).toEqual([]);
  });

  it("erasing without the full record is refused, not guessed", async () => {
    mockHttp([]);

    await expect(
      updateContact.execute(newClient(), {
        contact_id: ID, first_name: "BARBE", last_name: "", email: null,
      })
    ).rejects.toMatchObject({ code: "CONTACT_CLEAR_NEEDS_FULL_RECORD" });

    // The point of refusing: job_title, phone_number and linkedin_page were
    // not supplied, and /update would have deleted all three.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("the description tells the agent omission is safe and null erases", () => {
    const d = updateContact.description;
    expect(d).toMatch(/Omitting a field keeps it/i);
    expect(d).toMatch(/pass it as `null`/i);
    expect(d).toContain("CONTACT_CLEAR_NEEDS_FULL_RECORD");
  });
});
