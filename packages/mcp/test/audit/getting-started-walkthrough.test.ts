/**
 * Audit: the getting-started walkthrough (issue leadbay/product#3952) ships as
 * TWO surfaces — the `leadbay_getting_started` MCP prompt and the
 * `leadbay_getting_started` composite tool's step manifest. They are two
 * renderings of ONE sequence, so they can silently diverge: someone edits a
 * gate label in the template and the tool keeps returning the old one.
 *
 * This audit pins the pieces that must agree, plus the two product decisions
 * that a later well-meaning edit would erode: exactly one option per gate, and
 * gate 2 never spending the new user's quota.
 */

import { describe, it, expect } from "vitest";
import { GETTING_STARTED_MANIFEST } from "@leadbay/core";
import { listPrompts, getPrompt } from "../../src/prompts.js";
import { leadbay_getting_started, PROMPT_META } from "../../src/prompts.generated.js";

const BODY = leadbay_getting_started;

describe("audit: getting-started walkthrough", () => {
  it("the prompt is registered in the MCP catalog", () => {
    // Two-place registration: the .md.tmpl AND a CATALOG entry in prompts.ts.
    // leadbay_extend_my_lens / leadbay_followup_check_in each have a generated
    // body but NO catalog entry, so they never appear in prompts/list. This
    // asserts the new prompt didn't repeat that.
    expect(listPrompts().map((p) => p.name)).toContain("leadbay_getting_started");
  });

  it("prompts/get returns a non-empty user message and takes no arguments", () => {
    const result = getPrompt("leadbay_getting_started", {});
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0].role).toBe("user");
    const text = result.messages[0].content.type === "text" ? result.messages[0].content.text : "";
    expect(text.length).toBeGreaterThan(500);
    // A brand-new user does not parameterize their own onboarding.
    const entry = listPrompts().find((p) => p.name === "leadbay_getting_started");
    expect(entry?.arguments ?? []).toEqual([]);
    // No unsubstituted placeholders leaked into the shipped body.
    expect(text).not.toMatch(/\{\{arg:/);
  });

  it("opens on the account check and honors both pinned regressions", () => {
    // The tutorial's first beat is a real call, not prose. It must respect the
    // two locked account-status behaviours (WORKFLOWS #30 / #31).
    expect(BODY).toMatch(/leadbay_account_status/);
    // #30 — quota_status 401s on a new org with no plan. Never surface it, and
    // above all never turn it into "log in again" (the 401-hallucination bug).
    expect(BODY).toMatch(/quota_error/);
    expect(BODY).toMatch(/do NOT\s*\n?\s*tell the user to log in again or reconnect/);
    // #31 — the lens is withheld server-side unless asked; don't volunteer it.
    expect(BODY).toMatch(/Do not volunteer the lens/i);
  });

  it("declares ≥3 failure modes and names the spend gate", () => {
    const modes = PROMPT_META.leadbay_getting_started.failure_modes ?? [];
    // assembler.ts enforces ≥3 for prompts that call mutating tools
    // (leadbay_enrich_titles matches its mutatingPattern).
    expect(modes.length).toBeGreaterThanOrEqual(3);
    const joined = modes.join("\n");
    expect(joined).toMatch(/PAID reveal/);
    expect(joined).toMatch(/ONE option/);
  });

  it("the prompt's gate labels match the tool manifest exactly", () => {
    // The drift-catcher. Every manifest gate_label must appear verbatim in the
    // prompt body, so the two surfaces can't describe different tours.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(BODY, `gate ${step.n} label missing from prompt body`).toContain(step.gate_label);
    }
  });

  it("the prompt forbids running a step's tool without the click", () => {
    // The observed failure: the agent ran the tools straight through and never
    // fired a widget, so the user watched a demo instead of taking a tutorial.
    expect(BODY).toMatch(/NEVER run a step's tool without firing its widget first/);
    expect(BODY).toMatch(/Wait for the click/);
  });

  it("the opening is two lines then the widget — not a syllabus", () => {
    // Observed: the tour opened with paragraphs (what Leadbay is + a preview of
    // all five steps + gate 1's own explain beat) before the first button. A
    // first-run user wants to see it work, not read what's coming.
    expect(BODY).toMatch(/Keep the opening tiny/i);
    expect(BODY).toMatch(/Fire GATE 1's widget immediately, in the same message/);
    expect(BODY).toMatch(/Do NOT\*\* preview all five steps/);
    // Gate 1 must not stack a second explanation on top of the opening lines.
    expect(BODY).toMatch(/opening lines above ARE this gate's explanation/);
  });

  it("the prompt makes every gate explain before it asks", () => {
    // A tutorial has to teach, not just present buttons.
    expect(BODY).toMatch(/EVERY GATE IS TWO BEATS — EXPLAIN, THEN ASK/);
    expect(BODY).toMatch(/\*\*Explain first/);
  });

  it("the prompt tells the agent to map each gate's next_steps verbatim", () => {
    // Each step ships a {question, options[]} payload — the same shape
    // leadbay_pull_leads returns — so the agent renders it instead of
    // assembling a widget call from prose.
    expect(BODY).toMatch(/next_steps/);
    expect(BODY).toMatch(/VERBATIM/);
    expect(BODY).toMatch(/do not add a second option/i);
  });

  it("the prompt's gate widget text matches the manifest payload", () => {
    // Prompt and manifest are two renderings of one widget. If a later edit
    // reworded one side, the user would see different text depending on which
    // surface drove the tour.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(BODY, `gate ${step.n} question missing`).toContain(step.next_steps.question);
      expect(BODY, `gate ${step.n} description missing`).toContain(
        step.next_steps.options[0].description,
      );
    }
  });

  it("the prompt closes by teaching the phrases, and every row is in the body", () => {
    // The buttons vanish with the tour. A walkthrough that ends without telling
    // the user what to TYPE taught them to click a tutorial, not use Leadbay.
    expect(BODY).toMatch(/buttons disappear when this walkthrough ends/i);
    expect(BODY).toMatch(/keep_going/);
    for (const row of GETTING_STARTED_MANIFEST.keep_going) {
      expect(BODY, `cheat-sheet phrase "${row.say}" missing from prompt`).toContain(row.say);
    }
    // Verbatim or it stops routing.
    expect(BODY).toMatch(/VERBATIM/);
  });

  it("the prompt body carries the one-option rule", () => {
    expect(BODY).toMatch(/\*\*exactly ONE option\*\*/);
    expect(BODY).toMatch(/Not one plus "Skip"/);
    // The escape hatch is typing, not a "Skip" button.
    expect(BODY).toMatch(/typing/i);
  });

  it("the prompt body forbids every paid-reveal argument", () => {
    // Mirrors the manifest's forbidden_args. If the template stops naming one,
    // the agent loses the only instruction preventing a paid launch.
    for (const arg of GETTING_STARTED_MANIFEST.steps[1].forbidden_args ?? []) {
      expect(BODY, `prompt body must forbid \`${arg}\``).toMatch(new RegExp(arg));
    }
    expect(BODY).toMatch(/SPENDS NOTHING/);
  });

  it("the prompt body handles the warming lens instead of reporting empty", () => {
    expect(BODY).toMatch(/computing_wishlist/);
    expect(BODY).toMatch(/computing_scores/);
    expect(BODY).toMatch(/NEVER say "no leads found\."/);
  });

  it("the prompt defers scheduling to the host and claims nothing", () => {
    // Leadbay has no scheduling API; the tour must not pretend otherwise.
    expect(BODY).toMatch(/no scheduling API/);
    expect(BODY).toMatch(/never claim a scheduled task was created/i);
    // The gate text must carry the literal recurring language the host's
    // scheduled-task flow gates on.
    expect(BODY).toMatch(/every morning/);
  });

  it("the prompt delegates the CRM push to the agent's OWN connector", () => {
    // Leadbay has NO CRM integration — no push, export or sync exists. The
    // whole point of this gate is that the HOST often has a connector even
    // though Leadbay doesn't.
    expect(BODY).toMatch(/no CRM integration/i);
    expect(BODY).toMatch(/check your own tool set/i);
    // Detection reuses the existing outreach-tool mechanism rather than
    // inventing a second one.
    expect(BODY).toMatch(/installed-connector/);
  });

  it("the prompt names CRM capability, not third-party tool names", () => {
    // Repo style: name the product/capability and let the agent find its own
    // tool. A backticked `hubspot_*` tool name would be the first in the repo
    // and would silently rot when the connector renames its tools.
    expect(BODY).toMatch(/HubSpot/);
    expect(BODY).not.toMatch(/`hubspot_[a-z_]+`/i);
    expect(BODY).not.toMatch(/`salesforce_[a-z_]+`/i);
  });

  it("the CRM gate cannot claim a record was created, or invent contact details", () => {
    expect(BODY).toMatch(/Never claim a CRM record was created/i);
    // Gate 2 was the FREE title preview: no email/phone was ever revealed, so
    // writing one into the user's CRM would be fabricated PII.
    expect(BODY).toMatch(/never write a contact detail you did not receive/i);
  });

  it("the no-connector path routes to the real escape hatch", () => {
    // A user with no CRM connector must get an honest line + the friction
    // route, not instructions for a connector they don't have.
    expect(BODY).toMatch(/leadbay_report_friction/);
    expect(BODY).toMatch(/missing_capability/);
  });

  it("does NOT re-implement the host's frequency/time sub-questions", () => {
    // Two competing scheduling flows in one conversation is a defect. The tour
    // hands off; it must not ask these itself.
    expect(BODY).not.toMatch(/Every weekday/);
    expect(BODY).not.toMatch(/Morning \(8am\)/);
    expect(BODY).not.toMatch(/Which day\?/);
  });

  it("routes orientation-prose asks to the overview prompt instead", () => {
    expect(BODY).toMatch(/leadbay_prospecting_overview/);
  });
});
