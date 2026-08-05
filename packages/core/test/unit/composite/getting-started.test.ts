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
// well-meaning edit: one forward option + an exit per gate, and gate 3 never spends.

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

  it("every gate ships a ready-made widget payload, not just loose strings", () => {
    // The reason a gate renders as a BUTTON instead of the model running the
    // tool straight through: each step carries `next_steps` in the same
    // {question, options[]} shape leadbay_pull_leads returns, which the shared
    // routing snippet says to map into the host widget VERBATIM. Without it the
    // agent has to assemble the widget call from prose — the weak path that let
    // it skip the widget entirely.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      const ns = step.next_steps;
      expect(ns, `step ${step.n} must carry next_steps`).toBeDefined();
      expect(ns.question.length, `step ${step.n} question`).toBeGreaterThan(0);
      // Two options — action + exit. A LONE option is rejected by the host
      // widget (it requires 2-4) and silently degrades to prose, which is the
      // live defect this shape exists to prevent.
      expect(ns.options, `step ${step.n} options`).toHaveLength(2);
      const [opt] = ns.options;
      // The payload must agree with the gate it belongs to, or the widget shows
      // one thing while the manifest documents another.
      expect(opt.label).toBe(step.gate_label);
      expect(opt.kind).toMatch(/^walkthrough_/);
      // AskUserQuestion caps labels at ~5 words; the sentence lives in description.
      expect(opt.label.split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(opt.description.length).toBeGreaterThan(opt.label.length);
    }
  });

  it("every gate explains itself before asking — it's a tutorial, not a button rack", () => {
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(step.explain, `step ${step.n} must carry an explain beat`).toBeTypeOf("string");
      expect(step.explain.length, `step ${step.n} explain non-trivial`).toBeGreaterThan(40);
    }
    // The two concepts a first-run user genuinely does not know yet.
    expect(GETTING_STARTED_MANIFEST.steps[1].explain).toMatch(/lens/i);
    expect(GETTING_STARTED_MANIFEST.steps[2].explain).toMatch(/free/i);
  });

  it("every gate carries exactly ONE way forward, plus an exit", () => {
    // The structural contract: one forward action so a first-run user never has
    // to choose between PATHS, plus an exit so the tour isn't a trap — and so
    // the payload satisfies the host widget's 2-4 option requirement.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(step.gate_label, `step ${step.n} label`).toBeTypeOf("string");
      expect(step.gate_label.length, `step ${step.n} label non-empty`).toBeGreaterThan(0);
      expect(step.gate_description, `step ${step.n} description`).toBeTypeOf("string");

      const opts = step.next_steps.options;
      expect(opts, `step ${step.n} option count`).toHaveLength(2);

      // Exactly one option moves the tour forward; the other is the exit.
      const exits = opts.filter((o) => o.kind === "walkthrough_exit");
      expect(exits, `step ${step.n} must carry exactly one exit`).toHaveLength(1);
      expect(exits[0].label).toBe("I'm done for now");
      // The exit must END the tour, never route somewhere else — an
      // alternative route would reintroduce the choice this rule removes.
      expect(exits[0].description).toMatch(/stop/i);

      // The forward option comes FIRST, so the obvious move is the top one.
      expect(opts[0].kind, `step ${step.n} forward option must be first`).not.toBe(
        "walkthrough_exit",
      );

      // And no stray top-level options container competing with next_steps.
      expect(step, `step ${step.n} must not carry a bare options array`).not.toHaveProperty(
        "options",
      );
    }
    expect(GETTING_STARTED_MANIFEST.one_option_rule).toMatch(/exactly ONE way forward/);
    // Never a third option, and the exit must not become an alternative route.
    expect(GETTING_STARTED_MANIFEST.one_option_rule).toMatch(/Never add a third option/);
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

    // When quota IS readable, the quota windows ARE the answer — the user
    // clicked "check my account status", so a bare "you're connected as X"
    // under-delivers on the button they pressed.
    const readable = branches.find((b) => b.when === "quota is readable");
    expect(readable, "readable-quota branch must exist").toBeDefined();
    expect(readable!.then).toMatch(/Daily \/ Weekly \/ Monthly/);
    expect(readable!.then).toMatch(/% used/);
    expect(readable!.then).toMatch(/resets/);
    // The web app speaks percentages and dollars, never raw credits.
    expect(readable!.then).toMatch(/never raw 'credits'/i);

    // WORKFLOWS #30 — a brand-new org has no billing plan, so quota_status
    // 401s. That must NOT become "log in again" (the 401-hallucination bug).
    const quota = branches.find((b) => b.when.includes("quota_error"));
    expect(quota, "quota_error branch must exist").toBeDefined();
    expect(quota!.then).toMatch(/Say NOTHING about quota/);
    expect(quota!.then).toMatch(/do NOT tell the user to log in again or reconnect/);
    // The silence gate covers all three cases, not just the 401.
    expect(quota!.when).toMatch(/unlimited_credits/);
    expect(quota!.then).toMatch(/no 'unlimited'/);

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

  it("hands the user real phrases to type once the buttons are gone", () => {
    const rows = GETTING_STARTED_MANIFEST.keep_going;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(r.want.length, "want column").toBeGreaterThan(0);
      expect(r.say.length, "say column").toBeGreaterThan(0);
    }
    // The two things the walkthrough itself demonstrated must be reachable by
    // typing, or the tutorial taught a click the user can never repeat.
    const said = rows.map((r) => r.say.toLowerCase());
    expect(said.some((s) => s.includes("today's leads"))).toBe(true);
    expect(said.some((s) => s.includes("follow up"))).toBe(true);
  });

  it("every taught phrase actually matches a shipped tool trigger", () => {
    // The load-bearing assertion: a cheat-sheet phrase that doesn't route is
    // worse than no cheat-sheet. Each `say` is supposed to be lifted verbatim
    // from some tool's own routing.triggers block, so check it against the
    // real, generated descriptions rather than trusting the comment.
    const triggerText = [...compositeReadTools, ...compositeWriteTools]
      .map((t) => (t.description.match(/Trigger phrases: ([^\n]+)/) ?? [])[1] ?? "")
      .join(" ")
      .toLowerCase();
    for (const r of GETTING_STARTED_MANIFEST.keep_going) {
      // Placeholders (<Company>) differ per user; compare the fixed stem.
      const stem = r.say.toLowerCase().split("<")[0].trim();
      expect(
        triggerText.includes(stem),
        `"${r.say}" is taught to users but no shipped tool lists "${stem}" as a trigger`,
      ).toBe(true);
    }
  });

  it("the tour never takes outbound action", () => {
    expect(GETTING_STARTED_MANIFEST.stop).toMatch(/never takes outbound action/);
    expect(GETTING_STARTED_MANIFEST.stop).toMatch(/leadbay_report_outreach/);
  });
});
