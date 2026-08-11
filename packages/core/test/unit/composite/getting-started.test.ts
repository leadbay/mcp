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
// well-meaning edit: one forward option + an exit per gate, gate 3 drafting
// without ever spending, and gate 4 never revealing a contact WITHOUT an
// explicit confirm from the user.

describe("leadbay_getting_started", () => {
  it("happy path — returns the 4-step manifest with no HTTP call", async () => {
    mockHttp([]);
    const result = await gettingStarted.execute(newClient(), {});
    expect(result.version).toBe(1);
    expect(result.steps).toHaveLength(4);
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
    // Gate 3 drafts — its promise is that nothing is SENT, not that it's free.
    expect(GETTING_STARTED_MANIFEST.steps[2].explain).toMatch(/nothing is sent/i);
    // Gate 4 is where "free first, paid on consent" has to be said out loud.
    expect(GETTING_STARTED_MANIFEST.steps[3].explain).toMatch(/free/i);
  });

  it("every gate says WHY the step is useful, not just what it does", () => {
    // "What this does" alone is a feature list. A first-run user is deciding
    // whether Leadbay is worth their time, so each gate has to land a concrete
    // payoff in their own working life.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(
        step.explain,
        `step ${step.n} ("${step.gate_label}") has no WHY IT'S USEFUL payoff`,
      ).toMatch(/WHY IT'S USEFUL/);
    }
  });

  it("the opening teaches what Leadbay is and how the lens works", () => {
    // A paragraph, not a two-line tease: the user should understand the model
    // before they click, and know what they'll have at the end.
    const intro = GETTING_STARTED_MANIFEST.intro;
    expect(intro).toMatch(/lens/i);
    expect(intro).toMatch(/four quick steps/i);
    // Still bounded — the syllabus version buried the first button.
    expect(intro).toMatch(/do NOT walk through the four steps one at a time/i);
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
      "Draft the first email",
      "Find who to email",
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
    // Numbers alone teach nothing — a first-run user can't tell if they're
    // good or bad, so the gate has to say what they count and why they matter.
    expect(readable!.then).toMatch(/THEN EXPLAIN IT/);
    expect(readable!.then).toMatch(/paces how many fresh leads arrive/);

    // WORKFLOWS #30 — a brand-new org has no billing plan, so quota_status
    // 401s. That must NOT become "log in again" (the 401-hallucination bug).
    const quota = branches.find((b) => b.when.includes("quota_error"));
    expect(quota, "quota_error branch must exist").toBeDefined();
    expect(quota!.then).toMatch(/Say NOTHING about quota/);
    expect(quota!.then).toMatch(/do NOT tell the user to log in again or reconnect/);
    // The silence gate covers all three cases, not just the 401.
    expect(quota!.when).toMatch(/unlimited_credits/);
    expect(quota!.then).toMatch(/no 'unlimited'/);
    // …and the EXPLANATION is skipped with it. Explaining a gauge that isn't
    // on screen is worse than saying nothing.
    expect(quota!.then).toMatch(/skip the quota EXPLANATION too/);

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

  it("step 4 runs free-preview FIRST and only spends after an explicit confirm", () => {
    const step = GETTING_STARTED_MANIFEST.steps[3];
    expect(step.calls).toBe("leadbay_enrich_titles");
    // It must still scope to the leads from step 2 and the pinned lens.
    expect(Object.keys(step.args ?? {}).sort()).toEqual(["leadIds", "lensId"]);

    // Beat 1 is the free discovery preview — passing titles/confirm/email/phone
    // on the FIRST call would spend before the user has chosen anything.
    expect(step.spend).toMatch(/TWO BEATS/);
    expect(step.spend).toMatch(/NO titles \/ NO confirm \/ NO email \/ NO phone/);
    expect(step.spend).toMatch(/discover/);

    // Beat 2 is the real, paid reveal — but ONLY after a pick + confirm.
    expect(step.spend).toMatch(/confirm:true/);
    expect(step.spend).toMatch(/ONE contact, one credit|one credit/i);
    expect(step.spend).toMatch(/leadbay_bulk_enrich_status/);
    // The consent rule, stated so it can't be rationalized away.
    expect(step.spend).toMatch(/silence is not consent/i);
  });

  it("step 4 tells the user what the enrichment cost", () => {
    // They just watched credits move. Saying nothing is what makes quota feel
    // like a surprise bill later.
    const step = GETTING_STARTED_MANIFEST.steps[3];
    expect(step.quota_note, "step 4 must explain the spend").toBeTypeOf("string");
    expect(step.quota_note).toMatch(/one credit per contact/i);
    expect(step.quota_note).toMatch(/pricing pitch/i);
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
    expect(result.steps).toHaveLength(4);
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

  it("carries the setup guide, for the problem the tour cannot fix", () => {
    // The walkthrough assumes an installed, signed-in connector — gate 1 is
    // what proves it. A user whose connector isn't installed, who can't sign
    // in, or whose tools aren't appearing is upstream of every gate here, and
    // the tour has nothing for them. The docs page does.
    expect(GETTING_STARTED_MANIFEST.docs_url).toBe(
      "https://docs.leadbay.app/doc/leadbay-mcp/quickstart",
    );
    expect(GETTING_STARTED_MANIFEST.docs_note).toMatch(/setup/i);
    expect(GETTING_STARTED_MANIFEST.docs_note).toMatch(/sign in|signed[- ]in/i);
  });

  it("bounds the setup link to two moments and forbids it mid-tour", () => {
    // A link between gates is an invitation to leave the thing they're in the
    // middle of. The note must name BOTH sanctioned moments (the pre-tour
    // setup check and the closing) and forbid the rest, or a later edit will
    // read "here's a helpful link" as licence to sprinkle it everywhere.
    const note = GETTING_STARTED_MANIFEST.docs_note;
    expect(note).toMatch(/TWO moments/i);
    expect(note).toMatch(/BEFORE the\s+tour/i);
    expect(note).toMatch(/CLOSING/i);
    expect(note).toMatch(/NEVER paste it between gates/i);
  });

  it("offers a 1:1 when the user takes the exit, and only then", () => {
    // Going quiet on the exit wastes the goodwill the tour just earned: they
    // stopped right before the setup work a call actually helps with. But the
    // offer is scoped — mid-tour, or on top of an off-script question, the
    // same link is an interruption.
    expect(GETTING_STARTED_MANIFEST.calendly_url).toMatch(/^https:\/\/calendly\.com\//);
    const offer = GETTING_STARTED_MANIFEST.exit_offer;
    expect(offer).toMatch(/I'm done for now/);
    // The ORDER is the fix for the observed failure: an agent that renders the
    // cheat-sheet feels finished and stops, so the offer never lands. It is
    // beat 3 of 3, it is REQUIRED, and it goes last.
    expect(offer).toMatch(/THREE beats/i);
    expect(offer).toMatch(/LAST, and REQUIRED/i);
    expect(offer).toMatch(/WITHOUT the offer is\s+incomplete/i);
    // It must not become a pitch, or a lever to restart the tour.
    expect(offer).toMatch(/Never re-open the walkthrough/i);
    expect(offer).toMatch(/promotional copy/i);
    // The length rule is the load-bearing half — the previous sample copy ran
    // two sentences and the live judge marked it down as a pitch.
    expect(offer).toMatch(/ONE SENTENCE/);
    // Typed-exit is a different ending: serve the question, drop all of it.
    expect(offer).toMatch(/ENDING C, not B/i);
  });

  it("the tour drafts an email but never sends one", () => {
    // Narrowed deliberately when gate 3 landed: DRAFTING is the whole point of
    // that gate and nothing leaves the chat, but sending — and logging an
    // outreach that never happened — stay forbidden.
    expect(GETTING_STARTED_MANIFEST.stop).toMatch(/DRAFTS an email at gate 3 but never SENDS/);
    expect(GETTING_STARTED_MANIFEST.stop).toMatch(/never call\s+leadbay_report_outreach/);
  });

  it("gate 3 drafts for free and can never be talked into spending", () => {
    // The draft click bought an email, not a contact reveal. prepare_outreach
    // takes an `enrich` flag that launches a PAID reveal — passing it here
    // would spend credits the user never agreed to.
    const step = GETTING_STARTED_MANIFEST.steps[2];
    expect(step.calls).toBe("leadbay_prepare_outreach");
    expect(Object.keys(step.args ?? {})).toEqual(["leadId"]);
    expect(step.forbidden_args?.join(" ")).toMatch(/enrich/);
    expect(step.spend).toMatch(/spends NOTHING/i);
  });

  it("gate 3 addresses the draft to a TITLE, because no name exists yet", () => {
    // recommended_contact comes back with null email/name before gate 4, so a
    // named recipient at this point is fabricated — the one thing that would
    // make the whole draft untrustworthy. The null is the hook, not a bug.
    const step = GETTING_STARTED_MANIFEST.steps[2];
    const always = (step.branches ?? []).find((b) => b.when === "always");
    expect(always!.then).toMatch(/JOB TITLE/);
    expect(always!.then).toMatch(/inventing one is fabrication/i);
    expect(always!.then).toMatch(/message_compose_v1/);
    expect(step.spend).toMatch(/EXPECTED, not a failure/);
  });

  it("gate 4 enriches only the lead gate 3 drafted for", () => {
    // The narrative depends on it: this reveals the person THAT email is going
    // to. Fanning out across the batch turns one credit into several and loses
    // the thread back to the draft.
    const step = GETTING_STARTED_MANIFEST.steps[3];
    expect(step.args?.leadIds).toMatch(/ONE lead you drafted for/);
    expect(step.explain).toMatch(/addressed to a job title, not a person/i);
  });
});
