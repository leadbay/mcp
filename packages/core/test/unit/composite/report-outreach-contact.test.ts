/**
 * leadbay_report_outreach logs on the person when given contact_id, and a
 * Gmail message or calendar event already logged is not logged twice
 * (product#4174: the daily mailbox sync re-reads the same window).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
  expectAllScriptsConsumed,
} from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { reportOutreach } from "../../../src/composite/report-outreach.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

const LEAD = "f337bd2c-b0b2-40de-bf1a-cd50633e7f48";
const CONTACT = "3bbbbb57-6bfa-4202-94c6-9a1dec8ef0e9";
const gmail = (ref: string) => ({ source: "gmail_message_id" as const, ref });
const loggedLine = (ref: string) =>
  `Email sent: offre\n\n— logged by AI agent (verification: gmail_message_id=${ref})`;

beforeEach(() => resetHttpMock());

describe("leadbay_report_outreach on a person", () => {
  it("writes the note and the status on the contact", async () => {
    mockHttp([
      { method: "GET", path: `/1.6/contacts/${CONTACT}/notes`, status: 200, body: [] },
      {
        method: "POST",
        path: `/1.6/contacts/${CONTACT}/notes`,
        status: 201,
        body: { id: "cn1", org_contact_id: CONTACT, note: "x", created_at: "2026-09-18T10:00:00Z" },
      },
      {
        method: "PATCH",
        path: `/1.6/contacts/${CONTACT}/prospecting-status`,
        status: 200,
        body: { status: "EPILOGUE_STILL_CHASING", set_at: "2026-09-18T10:00:00Z" },
      },
    ]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_id: LEAD,
      contact_id: CONTACT,
      note: "Email sent: offre",
      epilogue_status: "STILL_CHASING",
      verification: gmail("18f0aaa"),
    });

    expect(r.notes.succeeded).toEqual([{ lead_id: LEAD, note_id: "cn1" }]);
    expect(r.epilogue).toEqual({ status: "EPILOGUE_STILL_CHASING", applied: true });
    expect(r.contact_id).toBe(CONTACT);
    const post = getHttpRequests().find((q) => q.method === "POST")!;
    expect(JSON.parse(post.body!).note).toBe(loggedLine("18f0aaa"));
    const patch = getHttpRequests().find((q) => q.method === "PATCH")!;
    expect(JSON.parse(patch.body!)).toEqual({ status: "EPILOGUE_STILL_CHASING" });
    expect(getHttpRequests().map((q) => q.path)).not.toContain("/1.6/leads/epilogue");
    expectAllScriptsConsumed();
  });

  it("the same Gmail message a second time writes nothing", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/contacts/${CONTACT}/notes`,
        status: 200,
        body: [{ id: "cn1", org_contact_id: CONTACT, note: loggedLine("18f0aaa"), created_at: "2026-09-17T10:00:00Z" }],
      },
    ]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_id: LEAD,
      contact_id: CONTACT,
      note: "Email sent: offre",
      epilogue_status: "STILL_CHASING",
      verification: gmail("18f0aaa"),
    });

    expect(r.already_logged).toEqual([LEAD]);
    expect(r.notes.succeeded).toEqual([]);
    expect(r.epilogue.applied).toBe(false);
    expect(getHttpRequests().map((q) => q.method)).toEqual(["GET"]);
  });

  it("another message to the same person is still logged", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/contacts/${CONTACT}/notes`,
        status: 200,
        body: [{ id: "cn1", org_contact_id: CONTACT, note: loggedLine("18f0aaa"), created_at: "2026-09-17T10:00:00Z" }],
      },
      {
        method: "POST",
        path: `/1.6/contacts/${CONTACT}/notes`,
        status: 201,
        body: { id: "cn2", org_contact_id: CONTACT, note: "x", created_at: "2026-09-18T10:00:00Z" },
      },
    ]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_id: LEAD,
      contact_id: CONTACT,
      note: "Replied: rappelez-moi lundi",
      verification: gmail("18f0bbb"),
    });

    expect(r.notes.succeeded).toEqual([{ lead_id: LEAD, note_id: "cn2" }]);
    expect(r).not.toHaveProperty("already_logged");
  });

  it("a lead-level log skips a message already in the lead's notes", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/leads/${LEAD}/notes`,
        status: 200,
        body: [{ id: "n1", note: loggedLine("18f0aaa"), created_at: "2026-09-17T10:00:00Z" }],
      },
    ]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_id: LEAD,
      note: "Email sent: offre",
      epilogue_status: "STILL_CHASING",
      verification: gmail("18f0aaa"),
    });

    expect(r.already_logged).toEqual([LEAD]);
    expect(getHttpRequests().map((q) => `${q.method} ${q.path}`)).toEqual([
      `GET /1.6/leads/${LEAD}/notes`,
    ]);
  });

  it("a failed notes read still logs, so nothing is lost", async () => {
    mockHttp([
      { method: "GET", path: `/1.6/contacts/${CONTACT}/notes`, status: 500, body: { code: "ERROR" } },
      {
        method: "POST",
        path: `/1.6/contacts/${CONTACT}/notes`,
        status: 201,
        body: { id: "cn3", org_contact_id: CONTACT, note: "x", created_at: "2026-09-18T10:00:00Z" },
      },
    ]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_id: LEAD,
      contact_id: CONTACT,
      note: "Email sent: offre",
      verification: gmail("18f0ccc"),
    });

    expect(r.notes.succeeded).toEqual([{ lead_id: LEAD, note_id: "cn3" }]);
  });

  it("contact_id with lead_ids is refused before any request", async () => {
    mockHttp([]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_ids: [LEAD, "other"],
      contact_id: CONTACT,
      note: "Email sent: offre",
      verification: gmail("18f0aaa"),
    });

    expect(r.code).toBe("BAD_INPUT");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("dry_run shows the person endpoints", async () => {
    mockHttp([]);

    const r: any = await reportOutreach.execute(newClient(), {
      lead_id: LEAD,
      contact_id: CONTACT,
      note: "Meeting: démo, 22 sept.",
      epilogue_status: "INTEREST_VALIDATED_OR_MEETING_PLANED",
      verification: { source: "calendar_event_id", ref: "evt_42" },
      dry_run: true,
    });

    expect(r.would_write_notes[0].path).toBe(`/contacts/${CONTACT}/notes`);
    expect(r.would_set_epilogue).toEqual({
      method: "PATCH",
      path: `/contacts/${CONTACT}/prospecting-status`,
      body: { status: "EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED" },
    });
    expect(getHttpRequests()).toHaveLength(0);
  });
});
