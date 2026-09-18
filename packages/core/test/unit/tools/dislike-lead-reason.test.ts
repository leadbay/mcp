// product#4170 — a dislike carries the user's reason to Leadbay as a lead note,
// and its response says the targeting did not change.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { dislikeLead } from "../../../src/tools/dislike-lead.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const LEAD = "lead-1";
const DISLIKE = { method: "POST", path: `/1.6/leads/${LEAD}/dislike`, status: 204, body: "" };
const ME = {
  method: "GET",
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u1", email: "u@x.co", admin: true, last_requested_lens: 7, organization: { id: "org-1" } },
};
const LEAD_SCORE = (score: number | null) => ({
  method: "GET",
  path: `/1.6/lenses/7/leads/${LEAD}/with_or_without_lens`,
  status: 200,
  body: { id: LEAD, ai_agent_lead_score: score },
});
const NOTE = {
  id: "note-9",
  note: "Disliked: société de conseil IA, hors ICP",
  created_at: "2026-09-17T14:25:56Z",
};

beforeEach(() => resetHttpMock());

describe("leadbay_dislike_lead reason", () => {
  it("accepts `reason` in its input schema", () => {
    const props = (dislikeLead.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.reason).toBeDefined();
  });

  it("saves the reason as a note on the lead after the dislike", async () => {
    mockHttp([
      DISLIKE,
      ME,
      LEAD_SCORE(30),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      { method: "POST", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTE },
    ]);

    const result = (await dislikeLead.execute(newClient(), {
      lead_id: LEAD,
      reason: "  société de conseil IA, hors ICP ",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      applied: true,
      lead_id: LEAD,
      action: "disliked",
      reason_saved: true,
      note_id: "note-9",
    });
    const reqs = getHttpRequests();
    expect(`${reqs[0].method} ${reqs[0].path}`).toBe(`POST /1.6/leads/${LEAD}/dislike`);
    const post = reqs.find((r) => r.method === "POST" && r.path.endsWith("/notes"));
    expect(JSON.parse(post!.body as string)).toEqual({
      note: "Disliked: société de conseil IA, hors ICP",
    });
  });

  it("a repeated call with the same reason writes no second note", async () => {
    mockHttp([
      DISLIKE,
      ME,
      LEAD_SCORE(30),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [NOTE] },
    ]);

    const result = (await dislikeLead.execute(newClient(), {
      lead_id: LEAD,
      reason: "société de conseil IA, hors ICP",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({ reason_saved: true, note_id: "note-9" });
    expect(getHttpRequests().filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("no reason, or a blank one, sends the dislike alone", async () => {
    mockHttp([DISLIKE, DISLIKE]);

    const bare = (await dislikeLead.execute(newClient(), { lead_id: LEAD })) as Record<string, unknown>;
    const blank = (await dislikeLead.execute(newClient(), { lead_id: LEAD, reason: "   " })) as Record<
      string,
      unknown
    >;

    expect(bare.reason_saved).toBeUndefined();
    expect(blank.reason_saved).toBeUndefined();
    expect(getHttpRequests().every((r) => r.path.endsWith("/dislike"))).toBe(true);
  });

  it("a failed note keeps the dislike and says the reason was not saved", async () => {
    mockHttp([
      DISLIKE,
      ME,
      LEAD_SCORE(30),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      { method: "POST", path: `/1.6/leads/${LEAD}/notes`, status: 500, body: { message: "boom" } },
    ]);

    const result = (await dislikeLead.execute(newClient(), {
      lead_id: LEAD,
      reason: "unpaid invoice with them",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({ applied: true, action: "disliked", reason_saved: false });
    expect(typeof result.reason_error).toBe("string");
    expect(String(result.hint)).toContain("same lead_id and reason");
  });

  it("a failed dislike throws and writes no note", async () => {
    mockHttp([{ method: "POST", path: `/1.6/leads/${LEAD}/dislike`, status: 404, body: {} }]);

    await expect(
      dislikeLead.execute(newClient(), { lead_id: LEAD, reason: "hors ICP" }),
    ).rejects.toBeTruthy();
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("returns the lead's qualification score with the reason", async () => {
    mockHttp([
      DISLIKE,
      ME,
      LEAD_SCORE(-30),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      { method: "POST", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTE },
    ]);

    const result = (await dislikeLead.execute(newClient(), {
      lead_id: LEAD,
      reason: "off-site caterer, no facility to floor",
    })) as Record<string, unknown>;

    expect(result.ai_score).toBe(-30);
    expect(String(result.targeting)).toMatch(/^Unchanged, and nothing to change: qualification already scores this lead at -30/);
  });

  it("a positive score keeps the general targeting guidance", async () => {
    mockHttp([
      DISLIKE,
      ME,
      LEAD_SCORE(30),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      { method: "POST", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTE },
    ]);

    const result = (await dislikeLead.execute(newClient(), {
      lead_id: LEAD,
      reason: "one location of a multi-site chain",
    })) as Record<string, unknown>;

    expect(result.ai_score).toBe(30);
    expect(String(result.targeting)).toContain("add_anti_patterns");
  });

  it("a failed score read drops the field and keeps the note", async () => {
    mockHttp([
      DISLIKE,
      ME,
      { method: "GET", path: `/1.6/lenses/7/leads/${LEAD}/with_or_without_lens`, status: 404, body: {} },
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      { method: "POST", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTE },
    ]);

    const result = (await dislikeLead.execute(newClient(), {
      lead_id: LEAD,
      reason: "franchise chain",
    })) as Record<string, unknown>;

    expect(result.reason_saved).toBe(true);
    expect("ai_score" in result).toBe(false);
  });

  it("every response says the targeting did not change", async () => {
    mockHttp([DISLIKE]);

    const result = (await dislikeLead.execute(newClient(), { lead_id: LEAD })) as Record<string, unknown>;

    const targeting = String(result.targeting).replace(/\s+/g, " ");
    expect(targeting).toMatch(/^Unchanged\./);
    expect(targeting).toContain("leadbay_get_qualification_questions");
    expect(targeting).toContain("add_anti_patterns");
  });
});
