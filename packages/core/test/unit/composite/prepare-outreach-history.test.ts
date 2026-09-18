// product#4168: leadbay_prepare_outreach's render spec asked for the lead's
// history, and the drafting agent needed Leadbay's research, but the payload
// carried neither. These tests pin that the brief now carries the notes on the
// lead and on its people, the activity timeline, the qualification answers and
// the web signals.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  expectAllScriptsConsumed,
  type RequestScript,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { prepareOutreach } from "../../../src/composite/prepare-outreach.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const LEAD = "b3d4ff15-77b8-44bb-8d02-70c7b7dfc776";

beforeEach(() => resetHttpMock());

const CONTACT = {
  id: "c-1",
  first_name: "Dana",
  last_name: "Reyes",
  email: "dana@progressivecargo.com",
  phone_number: null,
  linkedin_page: null,
  job_title: "Operations Director",
  recommended: true,
};

// Both getContacts and getLeadProfile read the two contact endpoints, so each
// needs two scripts (the harness consumes one script per request).
function contactScripts(): RequestScript[] {
  return [
    { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [CONTACT] },
    { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [CONTACT] },
    { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
    { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
  ];
}

function profileScripts(): RequestScript[] {
  return [
    {
      method: "GET",
      path: "/1.6/users/me",
      status: 200,
      body: { id: "u", organization: { id: "org-1", name: "X" }, last_requested_lens: 42 },
    },
    { method: "POST", path: "/1.6/interactions", status: 200, body: {} },
    {
      method: "GET",
      path: `/1.6/lenses/42/leads/${LEAD}`,
      status: 200,
      body: { id: LEAD, name: "PROGRESSIVE CARGO EXPRESS INC.", score: 88, website: "progressivecargo.com" },
    },
    {
      method: "GET",
      path: `/1.6/leads/${LEAD}/ai_agent_responses`,
      status: 200,
      body: [
        {
          question: "Runs a field sales team?",
          score: 20,
          response: "Yes, 12 regional reps listed on the careers page.",
          computed_at: "2026-09-01T00:00:00Z",
          outdated_at: null,
        },
      ],
    },
    {
      method: "GET",
      path: `/1.6/leads/${LEAD}/web_fetch`,
      status: 200,
      body: {
        lead_id: LEAD,
        fetch_at: "2026-09-02T00:00:00Z",
        content: {
          "📈 business signals": [
            { hot: true, source: "https://example.com/news", description: "Opened a Dallas hub in August." },
          ],
          "🏢 company profile": [
            { source: "https://progressivecargo.com", description: "Regional freight carrier, 40 trucks." },
          ],
        },
      },
    },
  ];
}

// Shapes copied from GET /1.6/leads/b3d4ff15-…/notes and /activities on
// api-us, 2026-09-17: notes arrive newest first and carry `created_by`.
const NOTES_BODY = [
  {
    id: "d54137a3",
    note: "Intro email sent to Dana citing the Dallas hub.\n\n— logged by AI agent (verification: user_confirmed=yes sent)",
    created_at: "2026-09-09T01:08:32.922707Z",
    created_by: "milstan",
    created_by_id: "9e463d38",
    editable: true,
  },
  {
    id: "035e560a",
    note: "Called the switchboard, Dana was out.",
    created_at: "2026-09-02T10:05:35.931745Z",
    created_by: "milstan",
    created_by_id: "9e463d38",
    editable: true,
  },
];
// GET /1.6/contacts/{id}/notes: a person note, which GET /leads/{id}/notes
// does not return. Shape from backend ContactNotePayload.
const CONTACT_NOTES_BODY = [
  {
    id: "5e1c0a77",
    org_contact_id: "c-1",
    campaign_id: null,
    campaign_name: null,
    note: "Dana asked for a quote after the October budget review.",
    created_at: "2026-09-05T14:00:00Z",
    created_by: "9e463d38",
    updated_at: null,
    updated_by: null,
    editable: true,
  },
];
const contactNotes = (body: unknown[] = []): RequestScript => ({
  method: "GET",
  path: "/1.6/contacts/c-1/notes",
  status: 200,
  body,
});

const ACTIVITIES_BODY = {
  items: [
    { lead_id: LEAD, user_id: "9e463d38", interaction_id: "683915", type: "EPILOGUE_STILL_CHASING", date: "2026-09-09T01:08:33.172314Z" },
    { lead_id: LEAD, user_id: "9e463d38", interaction_id: "683914", type: "CREATE_LEAD_NOTE", date: "2026-09-09T01:08:32.930552Z" },
  ],
  pagination: { page: 0, pages: 3, total: 46 },
};

describe("leadbay_prepare_outreach — history and research in the brief (product#4168)", () => {
  it("carries the lead's and its people's notes, activity timeline, qualification answers and signals", async () => {
    mockHttp([
      ...contactScripts(),
      ...profileScripts(),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTES_BODY },
      contactNotes(CONTACT_NOTES_BODY),
      { method: "GET", path: `/1.6/leads/${LEAD}/activities?count=20`, status: 200, body: ACTIVITIES_BODY },
    ]);

    const out = (await prepareOutreach.execute(newClient(), { leadId: LEAD })) as any;

    // One list, newest first: the person note sits between the two lead notes.
    expect(out.history.notes).toEqual([
      {
        date: "2026-09-09T01:08:32.922707Z",
        author: "milstan",
        contact: null,
        note: NOTES_BODY[0].note,
      },
      {
        date: "2026-09-05T14:00:00Z",
        author: null,
        contact: "Dana Reyes",
        note: "Dana asked for a quote after the October budget review.",
      },
      {
        date: "2026-09-02T10:05:35.931745Z",
        author: "milstan",
        contact: null,
        note: "Called the switchboard, Dana was out.",
      },
    ]);
    expect(out.history.activities).toEqual([
      { type: "EPILOGUE_STILL_CHASING", date: "2026-09-09T01:08:33.172314Z" },
      { type: "CREATE_LEAD_NOTE", date: "2026-09-09T01:08:32.930552Z" },
    ]);
    expect(out.history.activities_total).toBe(46);

    expect(out.qualification).toEqual([
      expect.objectContaining({
        question: "Runs a field sales team?",
        score: 20,
        response: "Yes, 12 regional reps listed on the careers page.",
      }),
    ]);
    // Same reshaping research_lead_by_id applies: profile before signals.
    expect(out.signals.map((s: any) => s.section_label)).toEqual([
      "company profile",
      "business signals",
    ]);
    expect(out.signals[1].entries[0].description).toBe("Opened a Dallas hub in August.");

    // The brief it already returned is unchanged.
    expect(out.lead.name).toBe("PROGRESSIVE CARGO EXPRESS INC.");
    expect(out.recommended_contact.email).toBe("dana@progressivecargo.com");

    // The two history reads happened, alongside the ones the brief already made.
    expectAllScriptsConsumed();
  });

  it("a lead nobody has worked yet returns empty lists", async () => {
    mockHttp([
      ...contactScripts(),
      ...profileScripts(),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      contactNotes(),
      {
        method: "GET",
        path: `/1.6/leads/${LEAD}/activities?count=20`,
        status: 200,
        body: { items: [], pagination: { page: 0, pages: 0, total: 0 } },
      },
    ]);

    const out = (await prepareOutreach.execute(newClient(), { leadId: LEAD })) as any;

    expect(out.history).toEqual({ notes: [], activities: [], activities_total: 0 });
  });

  it("a failed history read fails the call instead of returning a brief without history", async () => {
    mockHttp([
      ...contactScripts(),
      ...profileScripts(),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 500, body: { error: "boom" } },
      contactNotes(),
      { method: "GET", path: `/1.6/leads/${LEAD}/activities?count=20`, status: 200, body: ACTIVITIES_BODY },
    ]);

    await expect(prepareOutreach.execute(newClient(), { leadId: LEAD })).rejects.toThrow();
  });

  it("with several org contacts, one failed person-notes read fails the call", async () => {
    const OTHER = { ...CONTACT, id: "c-2", first_name: "Sam", recommended: false };
    mockHttp([
      { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [CONTACT, OTHER] },
      { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [CONTACT, OTHER] },
      { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
      { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
      ...profileScripts(),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTES_BODY },
      contactNotes(CONTACT_NOTES_BODY),
      { method: "GET", path: "/1.6/contacts/c-2/notes", status: 500, body: { error: "boom" } },
      { method: "GET", path: `/1.6/leads/${LEAD}/activities?count=20`, status: 200, body: ACTIVITIES_BODY },
    ]);

    // No brief with a partial history: the agent re-calls the read-only tool.
    // The only 500 scripted is Sam's notes, so that is the error surfaced.
    await expect(prepareOutreach.execute(newClient(), { leadId: LEAD })).rejects.toMatchObject({
      code: "API_ERROR",
      message: "API error (500)",
    });
  });

  it("reads person notes only for org contacts, the only ones that can hold them", async () => {
    const PAID = { ...CONTACT, id: "p-9", recommended: false };
    mockHttp([
      { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [CONTACT] },
      { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [CONTACT] },
      { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [PAID] },
      { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [PAID] },
      ...profileScripts(),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      contactNotes(CONTACT_NOTES_BODY),
      { method: "GET", path: `/1.6/leads/${LEAD}/activities?count=20`, status: 200, body: ACTIVITIES_BODY },
    ]);

    const out = (await prepareOutreach.execute(newClient(), { leadId: LEAD })) as any;

    expect(out.history.notes.map((n: any) => n.contact)).toEqual(["Dana Reyes"]);
    // No GET /contacts/p-9/notes: the harness would have rejected it.
    expectAllScriptsConsumed();
  });

  it("a failed qualification read is null, not an empty list", async () => {
    mockHttp([
      ...contactScripts(),
      ...profileScripts().map((s) =>
        typeof s.path === "string" && s.path.endsWith("/ai_agent_responses")
          ? { ...s, status: 500, body: { error: "boom" } }
          : s
      ),
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
      contactNotes(),
      { method: "GET", path: `/1.6/leads/${LEAD}/activities?count=20`, status: 200, body: ACTIVITIES_BODY },
    ]);

    const out = (await prepareOutreach.execute(newClient(), { leadId: LEAD })) as any;

    expect(out.qualification).toBeNull();
    expect(out.lead.name).toBe("PROGRESSIVE CARGO EXPRESS INC.");
  });

  it("when the profile cannot be read, research is null but history still arrives", async () => {
    mockHttp([
      ...contactScripts(),
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", name: "X" }, last_requested_lens: 42 },
      },
      { method: "POST", path: "/1.6/interactions", status: 200, body: {} },
      { method: "GET", path: `/1.6/lenses/42/leads/${LEAD}`, status: 404, body: { code: "NOT_FOUND" } },
      { method: "GET", path: `/1.6/leads/${LEAD}/ai_agent_responses`, status: 200, body: [] },
      { method: "GET", path: `/1.6/leads/${LEAD}/web_fetch`, status: 200, body: { content: null } },
      { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: NOTES_BODY },
      contactNotes(),
      { method: "GET", path: `/1.6/leads/${LEAD}/activities?count=20`, status: 200, body: ACTIVITIES_BODY },
    ]);

    const out = (await prepareOutreach.execute(newClient(), { leadId: LEAD })) as any;

    expect(out.qualification).toBeNull();
    expect(out.signals).toBeNull();
    expect(out.lead).toEqual({ id: LEAD, name: null, ai_summary: null });
    expect(out.history.notes).toHaveLength(2);
    expect(out.history.activities_total).toBe(46);
  });
});

describe("leadbay_prepare_outreach — the render spec asks only for what the payload carries", () => {
  // Snippets are hard-wrapped markdown: match on collapsed whitespace.
  const description = prepareOutreach.description.replace(/\s+/g, " ");
  const props = (prepareOutreach.outputSchema as any).properties;

  it("reads history from the `history` block, not a counter the payload never had", () => {
    expect(description).not.toContain("prospecting_actions_count");
    expect(description).not.toContain("History with [Contact name]");
    expect(description).toContain("From `history`, newest first");
    expect(Object.keys(props.history.properties)).toEqual(["notes", "activities", "activities_total"]);
  });

  it("names who a person note is about", () => {
    expect(description).toContain("each prefixed with its `contact` when set");
    expect(description).toContain("`notes` on the lead and on each of its people");
    expect(Object.keys(props.history.properties.notes.items.properties)).toEqual([
      "date",
      "author",
      "contact",
      "note",
    ]);
  });

  it("feeds the angles from the brief's own research, not a separate research call", () => {
    expect(description).not.toContain("signals from a prior `research_lead_by_id` call");
    expect(description).toContain("`split_ai_summary.next_step`, `signals` and `qualification`");
    expect(props.signals).toBeDefined();
    expect(props.qualification).toBeDefined();
  });
});
