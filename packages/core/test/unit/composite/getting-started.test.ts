import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  gettingStarted,
  GETTING_STARTED_MANIFEST,
} from "../../../src/composite/getting-started.js";
import { compositeReadTools, compositeWriteTools } from "../../../src/index.js";
import { COMPOSITE_FILE_TOOL_NAMES } from "../../../src/composite/_composite-file-names.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// leadbay_getting_started returns a static walkthrough manifest (issue #3952).
// These tests lock the two product decisions that are easy to erode by a later
// well-meaning edit: exactly ONE option per gate, and gate 3 never spends.

describe("leadbay_getting_started", () => {
  it("happy path — returns the 5-step manifest with no HTTP call", async () => {
    mockHttp([]);
    const result = await gettingStarted.execute(newClient(), {});
    expect(result.version).toBe(1);
    expect(result.steps).toHaveLength(5);
    // Static content: the tour must not touch the backend at all. This is the
    // whole basis for readOnlyHint + openWorldHint:false in the annotations.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("every gate carries exactly ONE option", () => {
    // THE one-option rule (Arty's explicit product decision). A gate is one
    // label + one description — never a menu, never a "Skip" sibling. If a
    // future edit adds a second option to a gate, this fails.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(step.gate_label, `step ${step.n} label`).toBeTypeOf("string");
      expect(step.gate_label.length, `step ${step.n} label non-empty`).toBeGreaterThan(0);
      expect(step.gate_description, `step ${step.n} description`).toBeTypeOf("string");
      // No plural option container anywhere on a step.
      expect(step, `step ${step.n} must not carry an options array`).not.toHaveProperty("options");
    }
    expect(GETTING_STARTED_MANIFEST.one_option_rule).toMatch(/exactly ONE option/);
    // The escape hatch is typing, not a button.
    expect(GETTING_STARTED_MANIFEST.one_option_rule).toMatch(/TYPING/);
  });

  it("gate labels are the specified sequence, in order", () => {
    expect(GETTING_STARTED_MANIFEST.steps.map((s) => s.gate_label)).toEqual([
      "Check my account",
      "Pull today's leads",
      "Enrich top leads",
      "Add these to my CRM",
      "Run this every morning",
    ]);
  });

  it("step 1 opens on the account and honors both pinned regressions", () => {
    // The tutorial's "you're connected" beat. It must prove the connection
    // works WITHOUT tripping the two account-status regressions.
    const step = GETTING_STARTED_MANIFEST.steps[0];
    expect(step.calls).toBe("leadbay_account_status");
    expect(step.args).toEqual({});
    const branches = step.branches ?? [];

    // WORKFLOWS #30 — a brand-new org has no billing plan, so quota_status
    // 401s. That must NOT become "log in again" (the 401-hallucination bug).
    const quota = branches.find((b) => b.when.includes("quota_error"));
    expect(quota, "quota_error branch must exist").toBeDefined();
    expect(quota!.then).toMatch(/Say NOTHING about quota/);
    expect(quota!.then).toMatch(/do NOT tell the user to log in again or reconnect/);

    // WORKFLOWS #31 — the lens is withheld server-side unless asked, so the
    // tour must not volunteer it, nor reach for another tool to find it.
    const lens = branches.find((b) => b.then.includes("volunteer the lens"));
    expect(lens, "lens-hygiene branch must exist").toBeDefined();
    expect(lens!.then).toMatch(/no other tool should be called to find it/);
  });

  it("step 2 calls leadbay_pull_leads with no args and pins the lens", () => {
    const step = GETTING_STARTED_MANIFEST.steps[1];
    expect(step.calls).toBe("leadbay_pull_leads");
    expect(step.args).toEqual({});
    // The pinned lens is what keeps gate 3 on the same lens the user just saw.
    expect(step.pin).toMatch(/lens\.id/);
  });

  it("step 2 declares all three empty-batch branches", () => {
    const branches = GETTING_STARTED_MANIFEST.steps[1].branches ?? [];
    expect(branches).toHaveLength(3);
    const warming = branches.find((b) => b.when.includes("computing_wishlist"));
    expect(warming, "warming-lens branch must exist").toBeDefined();
    // A brand-new lens reads empty for ~a minute. Reporting "no leads" there is
    // the single most likely way this tour insults a new user.
    expect(warming!.then).toMatch(/NEVER say 'no leads found'/);
    expect(warming!.then).toMatch(/VERBATIM/);
  });

  it("step 3 forbids every arg that would trigger a paid reveal", () => {
    const step = GETTING_STARTED_MANIFEST.steps[2];
    expect(step.calls).toBe("leadbay_enrich_titles");
    // Any one of these counts as consent in enrich-titles and launches a PAID
    // reveal. The tour is a demo on a 90-second-old account — it spends nothing.
    expect(step.forbidden_args).toEqual(["titles", "confirm", "email", "phone"]);
    expect(step.spend).toMatch(/NOTHING/);
    expect(step.spend).toMatch(/discover/);
    // It must still scope to the leads from step 2 and the pinned lens.
    expect(Object.keys(step.args ?? {}).sort()).toEqual(["leadIds", "lensId"]);
  });

  it("step 4 calls no Leadbay tool — the CRM connector is the host's", () => {
    const step = GETTING_STARTED_MANIFEST.steps[3];
    // calls:null is load-bearing. Leadbay has NO CRM integration, so an agent
    // reading the manifest must not be able to infer a leadbay_* tool that
    // would push, export or sync a lead.
    expect(step.calls).toBeNull();
    expect(step.args).toBeNull();
    expect(step.handoff).toMatch(/NO CRM integration/);
    // Delegation: the agent checks ITS OWN tool set, the same way it detects
    // outreach tooling. Capability named, not a third-party tool name.
    expect(step.handoff).toMatch(/your\s+own tool set/);
    expect(step.handoff).toMatch(/installed-connector/);
    // Honesty guards — the two ways this gate could lie to a new user.
    expect(step.handoff).toMatch(/NEVER claim a CRM record was created/);
    expect(step.handoff).toMatch(/never write a contact detail you did not receive/);
    // The no-connector path must route to the real escape hatch, not a dead end.
    expect(step.handoff).toMatch(/leadbay_report_friction/);
    expect(step.handoff).toMatch(/missing_capability/);
  });

  it("step 5 calls no Leadbay tool — scheduling is the host's", () => {
    const step = GETTING_STARTED_MANIFEST.steps[4];
    // Same delegation shape as step 4: Leadbay has no scheduling API either.
    expect(step.calls).toBeNull();
    expect(step.args).toBeNull();
    expect(step.handoff).toMatch(/no scheduling API/);
    expect(step.handoff).toMatch(/NEVER claim a scheduled task was created/);
    // The option text carries the literal recurring language the host's
    // scheduled-task flow gates on.
    expect(step.gate_label.toLowerCase()).toContain("every morning");
  });

  it("step 4 does not invent contact details it never received", () => {
    // Gate 3 is the FREE title preview — no email/phone is ever revealed. A CRM
    // push that writes them would be fabricating PII into the user's CRM.
    const step = GETTING_STARTED_MANIFEST.steps[3];
    expect(step.handoff).toMatch(/do NOT have the contact's email or phone/i);
  });

  it("no step invents a leadbay_* tool that does not exist", () => {
    const known = new Set([...compositeReadTools, ...compositeWriteTools].map((t) => t.name));
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      if (step.calls === null) continue;
      expect(known, `step ${step.n} calls an unregistered tool`).toContain(step.calls);
    }
  });

  it("is registered read-only, always-exposed, and carries the composite mandate", () => {
    expect(compositeReadTools.map((t) => t.name)).toContain("leadbay_getting_started");
    expect(compositeWriteTools.map((t) => t.name)).not.toContain("leadbay_getting_started");
    expect(gettingStarted.annotations?.readOnlyHint).toBe(true);
    expect(gettingStarted.annotations?.openWorldHint).toBe(false);
    expect(gettingStarted.write).toBe(false);
    // User-facing tool → composite → _triggered_by provenance mandate.
    expect(COMPOSITE_FILE_TOOL_NAMES).toContain("leadbay_getting_started");
  });

  it("takes no input — a new user does not parameterize their own onboarding", async () => {
    mockHttp([]);
    expect(gettingStarted.inputSchema.properties).toEqual({});
    expect(gettingStarted.inputSchema.additionalProperties).toBe(false);
    // Extra params are ignored rather than throwing: the manifest is invariant.
    const result = await gettingStarted.execute(newClient(), {} as never);
    expect(result.steps).toHaveLength(5);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("the tour never takes outbound action", () => {
    expect(GETTING_STARTED_MANIFEST.stop).toMatch(/never takes outbound action/);
    expect(GETTING_STARTED_MANIFEST.stop).toMatch(/leadbay_report_outreach/);
  });
});
