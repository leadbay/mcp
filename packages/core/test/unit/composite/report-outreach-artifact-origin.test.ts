/**
 * leadbay_report_outreach does not elicit for a call that came from an
 * artifact.
 *
 * The bug this pins: a page's Log-outreach button sends
 * `verification.source: "user_confirmed"`, which is exactly the condition that
 * opens `ctx.elicit()` — a prompt asking a human to type a confirmation. A
 * rendered page has nowhere to show one, so the call hung until the page's
 * call timeout fired and the rep was told "Leadbay took too long to answer. Try again
 * in a moment." The tool's own catch then fell through and wrote the row
 * anyway, so the change appeared in the app under an error message — and
 * following the advice logged the same visit twice.
 *
 * The protection is unchanged for agents: elicitation exists so an agent
 * cannot fabricate outreach that never happened, and an agent call carries no
 * `_origin`. Inside an artifact the rep pressed the button themselves, which
 * is the same consent the prompt asks for.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { reportOutreach } from "../../../src/composite/report-outreach.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");
const LEAD = "f337bd2c-b0b2-40de-bf1a-cd50633e7f48";

const confirmed = { source: "user_confirmed" as const, ref: "Logged by the rep in Route Planner" };

/** The writes a single-lead, note + epilogue call makes. */
const scriptOneLead = () =>
  mockHttp([
    { method: "GET", path: `/1.6/leads/${LEAD}/notes`, status: 200, body: [] },
    {
      method: "POST",
      path: `/1.6/leads/${LEAD}/notes`,
      status: 201,
      body: { id: "n1", note: "x", created_at: "2026-09-25T10:00:00Z" },
    },
    { method: "POST", path: "/1.6/leads/epilogue", status: 200, body: {} },
  ]);

beforeEach(() => resetHttpMock());

describe("a call from an artifact is not elicited", () => {
  it("never calls ctx.elicit when origin is artifact", async () => {
    scriptOneLead();
    let elicitCalls = 0;

    await reportOutreach.execute(
      newClient(),
      { lead_id: LEAD, note: "Visited, met the manager", epilogue_status: "STILL_CHASING", verification: confirmed },
      {
        origin: "artifact",
        // If this runs, the page is waiting on a prompt it cannot render.
        elicit: async () => {
          elicitCalls++;
          return { action: "accept", content: { confirmation: "yes" } };
        },
      } as any,
    );

    expect(elicitCalls).toBe(0);
  });

  it("still writes the note and the epilogue", async () => {
    // Skipping the prompt must not skip the work: the button's whole job is
    // the write.
    scriptOneLead();

    const r: any = await reportOutreach.execute(
      newClient(),
      { lead_id: LEAD, note: "Visited, met the manager", epilogue_status: "STILL_CHASING", verification: confirmed },
      { origin: "artifact", elicit: async () => ({ action: "accept", content: { confirmation: "y" } }) } as any,
    );

    expect(r.error).toBeUndefined();
    expect(r.notes.succeeded).toEqual([{ lead_id: LEAD, note_id: "n1" }]);
    const paths = getHttpRequests().map((q) => q.path);
    expect(paths).toContain("/1.6/leads/epilogue");
  });

  it("records artifact_action, not agent_supplied", async () => {
    // A rep's own click is neither an elicited confirmation nor an agent's
    // claim about one. Filing it as "agent_supplied" would put it in the same
    // audit bucket as an assertion no human made.
    scriptOneLead();

    const r: any = await reportOutreach.execute(
      newClient(),
      { lead_id: LEAD, note: "Visited, met the manager", epilogue_status: "STILL_CHASING", verification: confirmed },
      { origin: "artifact", elicit: async () => ({ action: "accept", content: { confirmation: "y" } }) } as any,
    );

    expect(r.confirmed_via).toBe("artifact_action");
  });
});

describe("an agent call is still elicited", () => {
  it("prompts when origin is agent", async () => {
    scriptOneLead();
    let elicitCalls = 0;

    await reportOutreach.execute(
      newClient(),
      { lead_id: LEAD, note: "Sent intro email", epilogue_status: "STILL_CHASING", verification: confirmed },
      {
        origin: "agent",
        elicit: async () => {
          elicitCalls++;
          return { action: "accept", content: { confirmation: "I called them Tuesday" } };
        },
      } as any,
    );

    expect(elicitCalls).toBe(1);
  });

  it("prompts when origin is absent, which is what an agent call looks like", async () => {
    // The server derives origin from `_origin`, which only the artifact
    // runtime stamps. No field means agent, and agents must be challenged.
    scriptOneLead();
    let elicitCalls = 0;

    await reportOutreach.execute(
      newClient(),
      { lead_id: LEAD, note: "Sent intro email", epilogue_status: "STILL_CHASING", verification: confirmed },
      {
        elicit: async () => {
          elicitCalls++;
          return { action: "accept", content: { confirmation: "I called them Tuesday" } };
        },
      } as any,
    );

    expect(elicitCalls).toBe(1);
  });

  it("a declined prompt still blocks the write", async () => {
    // The anti-fabrication guarantee, unchanged.
    mockHttp([]);

    const r: any = await reportOutreach.execute(
      newClient(),
      { lead_id: LEAD, note: "Sent intro email", verification: confirmed },
      { origin: "agent", elicit: async () => ({ action: "decline" }) } as any,
    );

    expect(r.error).toBe(true);
    expect(r.code).toBe("OUTREACH_USER_CANCELLED");
    expect(getHttpRequests()).toHaveLength(0);
  });
});
