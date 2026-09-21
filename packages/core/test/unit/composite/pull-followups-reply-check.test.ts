/**
 * pull_followups hands back the Gmail id report_outreach logged, so the agent
 * can open that thread and log a reply (product#4172).
 *
 * Note bodies are produced by report_outreach itself (dry_run), so a change to
 * the line it appends breaks these tests instead of silently hiding every id.
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
import { pullFollowups } from "../../../src/composite/pull-followups.js";
import { reportOutreach } from "../../../src/composite/report-outreach.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

async function loggedNote(
  source: "gmail_message_id" | "calendar_event_id" | "user_confirmed",
  ref: string,
  note = "Sent intro email to the CTO"
): Promise<string> {
  const r: any = await reportOutreach.execute(newClient(), {
    lead_id: "any",
    note,
    verification: { source, ref },
    dry_run: true,
  });
  return r.would_write_notes[0].body.note;
}

const lead = (id: string, notes_count: number) => ({
  id,
  name: `Company ${id}`,
  notes_count,
  last_monitor_action: notes_count ? "CREATE_LEAD_NOTE" : "PURCHASE_LEAD_CONTACT",
  last_monitor_action_at: "2026-09-10T09:00:00Z",
});

function monitorScripts(items: object[]) {
  return [
    { method: "GET", path: "/1.6/monitor/filter", status: 200, body: { criteria: [] } },
    {
      method: "GET",
      path: /\/1\.6\/monitor\?/,
      status: 200,
      body: { items, pagination: { page: 0, pages: 1, total: items.length } },
    },
  ];
}

describe("pull_followups reply check", () => {
  it("returns the latest Gmail id per lead and tells the agent to check the thread", async () => {
    mockHttp([
      ...monitorScripts([lead("emailed", 3), lead("untouched", 0)]),
      {
        method: "GET",
        path: "/1.6/leads/emailed/notes",
        status: 200,
        body: [
          { id: "n1", note: await loggedNote("gmail_message_id", "18f0first"), created_at: "2026-09-01T10:00:00Z" },
          { id: "n2", note: await loggedNote("gmail_message_id", "18f0relance"), created_at: "2026-09-08T10:00:00Z" },
          { id: "n3", note: await loggedNote("user_confirmed", "I called her"), created_at: "2026-09-09T10:00:00Z" },
        ],
      },
    ]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r.leads[0].last_logged_email).toEqual({
      gmail_message_id: "18f0relance",
      logged_at: "2026-09-08T10:00:00Z",
    });
    expect(r.leads[1]).not.toHaveProperty("last_logged_email");
    expect(r.reply_check).toContain("leadbay_report_outreach");
    expect(r.reply_check).toContain("gmail_message_id");
    // A lead with no notes costs no request.
    expect(getHttpRequests().map((q) => q.path)).not.toContain("/1.6/leads/untouched/notes");
    expectAllScriptsConsumed();
  });

  it("a logged reply becomes the new last_logged_email, so it is not flagged again", async () => {
    mockHttp([
      ...monitorScripts([lead("replied", 2)]),
      {
        method: "GET",
        path: "/1.6/leads/replied/notes",
        status: 200,
        body: [
          { id: "n1", note: await loggedNote("gmail_message_id", "18f0sent"), created_at: "2026-09-01T10:00:00Z" },
          {
            id: "n2",
            note: await loggedNote("gmail_message_id", "18f0reply", "Replied: happy to meet Tuesday"),
            created_at: "2026-09-03T08:00:00Z",
          },
        ],
      },
    ]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r.leads[0].last_logged_email).toEqual({
      gmail_message_id: "18f0reply",
      logged_at: "2026-09-03T08:00:00Z",
    });
  });

  it("no reply_check when no lead has an email logged with a Gmail id", async () => {
    mockHttp([
      ...monitorScripts([lead("called", 2), lead("booked", 1)]),
      {
        method: "GET",
        path: "/1.6/leads/called/notes",
        status: 200,
        body: [
          { id: "n1", note: await loggedNote("user_confirmed", "she picked up"), created_at: "2026-09-01T10:00:00Z" },
          { id: "n2", note: "A note a human typed in the app", created_at: "2026-09-02T10:00:00Z" },
        ],
      },
      {
        method: "GET",
        path: "/1.6/leads/booked/notes",
        status: 200,
        body: [{ id: "n3", note: await loggedNote("calendar_event_id", "evt_42"), created_at: "2026-09-02T10:00:00Z" }],
      },
    ]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r).not.toHaveProperty("reply_check");
    expect(r.leads.some((l: any) => "last_logged_email" in l)).toBe(false);
  });

  it("a notes read that fails leaves that lead unchecked and still returns the page", async () => {
    mockHttp([
      ...monitorScripts([lead("broken", 1), lead("emailed", 1)]),
      { method: "GET", path: "/1.6/leads/broken/notes", status: 404, body: { code: "NOT_FOUND" } },
      {
        method: "GET",
        path: "/1.6/leads/emailed/notes",
        status: 200,
        body: [{ id: "n1", note: await loggedNote("gmail_message_id", "18f0ok"), created_at: "2026-09-01T10:00:00Z" }],
      },
    ]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r.leads).toHaveLength(2);
    expect(r.leads[0]).not.toHaveProperty("last_logged_email");
    expect(r.leads[1].last_logged_email.gmail_message_id).toBe("18f0ok");
    expect(r.reply_check).toBeDefined();
  });
});
