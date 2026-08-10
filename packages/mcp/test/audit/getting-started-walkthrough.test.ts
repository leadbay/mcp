/**
 * Audit: the getting-started walkthrough (issue leadbay/product#3952) ships as
 * TWO surfaces — the `leadbay_getting_started` MCP prompt and the
 * `leadbay_getting_started` composite tool's step manifest. They are two
 * renderings of ONE sequence, so they can silently diverge: someone edits a
 * gate label in the template and the tool keeps returning the old one.
 *
 * This audit pins the pieces that must agree, plus the product decisions a
 * later well-meaning edit would erode: one forward option + an exit per gate,
 * gate 3 drafting without ever spending, and gate 4 never revealing a contact
 * without an explicit confirm.
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

  it("gate 1 delivers the real quota, not a one-line greeting", () => {
    // The user clicked a button labelled "check my account status". A bare
    // "you're connected as X at Y" under-delivers on that; the quota windows
    // ARE the answer whenever they're readable.
    expect(BODY).toMatch(/Daily \/ Weekly \/\s*\n?\s*Monthly/);
    expect(BODY).toMatch(/% used/);
    // The canonical rendering must be included, not re-invented inline.
    expect(BODY).toMatch(/RENDERING — quota windows/);
    expect(BODY).toMatch(/▰/);
    // …and the silence gate still wins when quota is unreadable/unlimited.
    expect(BODY).toMatch(/unlimited_credits/);

    // Numbers with no explanation teach nothing: a first-run user has never
    // seen these and can't tell whether they're good or bad.
    expect(BODY).toMatch(/explain what they're looking at/i);
    expect(BODY).toMatch(/paces how many fresh leads arrive/i);
    // Explaining a gauge that isn't on screen is worse than saying nothing.
    expect(BODY).toMatch(/skip this explanation too/i);
  });

  it("declares ≥3 failure modes and names the spend gate", () => {
    const modes = PROMPT_META.leadbay_getting_started.failure_modes ?? [];
    // assembler.ts enforces ≥3 for prompts that call mutating tools
    // (leadbay_enrich_titles matches its mutatingPattern).
    expect(modes.length).toBeGreaterThanOrEqual(3);
    const joined = modes.join("\n");
    expect(joined).toMatch(/PAID reveal/);
    expect(joined).toMatch(/forward action plus the/);
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

  it("the opening is a short paragraph then the widget — not a syllabus", () => {
    // It must TEACH (what Leadbay is, what a lens is, what the tour delivers)
    // without regressing to the earlier wall of text that walked all five steps
    // one by one and buried the first button.
    expect(BODY).toMatch(/A short paragraph, then the widget/i);
    expect(BODY).toMatch(/that\s*\n?\s*description is your \*\*lens\*\*/i);
    expect(BODY).toMatch(/fire GATE 1's widget immediately, in the same message/i);
    expect(BODY).toMatch(/Do NOT walk through the six steps one at a time/i);
    // Gate 1 must not stack a second explanation on top of the opening.
    expect(BODY).toMatch(/opening paragraph above IS this gate's explanation/);
  });

  it("every gate lands a concrete 'why it's useful' payoff", () => {
    // "What this does" alone is a feature list. Each gate has to say what it
    // changes in the user's working life, or the tutorial teaches mechanics
    // without ever making the case.
    const payoffs = BODY.match(/\*\*Why it's useful/gi) ?? [];
    expect(payoffs.length, "expected a payoff line on the teaching gates").toBeGreaterThanOrEqual(
      4,
    );
    // The concrete images, not abstractions — these are what make it land.
    expect(BODY).toMatch(/operations\s*\n?\s*director by name/i);
    expect(BODY).toMatch(/quietly die in a chat window/i);
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
    expect(BODY).toMatch(/do\s*\n?\s*not add a third option/i);
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
    expect(BODY).toMatch(/buttons disappear when the walkthrough ends/i);
    expect(BODY).toMatch(/keep_going/);
    for (const row of GETTING_STARTED_MANIFEST.keep_going) {
      expect(BODY, `cheat-sheet phrase "${row.say}" missing from prompt`).toContain(row.say);
    }
    // Verbatim or it stops routing.
    expect(BODY).toMatch(/VERBATIM/);
  });

  it("the prompt body carries the one-forward-option rule", () => {
    expect(BODY).toMatch(/\*\*exactly ONE way forward, plus a way out\*\*/);
    // The live defect: a lone option degraded to prose ("say the word and
    // I'll check it"), so the reason for the second option is spelled out.
    expect(BODY).toMatch(/requires 2–4\s*\n?\s*options/);
    expect(BODY).toMatch(/I'm done for now/);
    expect(BODY).toMatch(/Never add a third option/);
    // The escape hatch is typing, not a "Skip" button.
    expect(BODY).toMatch(/typing/i);
  });

  it("the prompt gates the paid reveal behind an explicit pick + confirm", () => {
    // Beat 1 is free; beat 2 spends. The ordering is the consent guarantee, so
    // the template must state both halves and the rule between them.
    expect(BODY).toMatch(/TWO BEATS\*\*\. Do not collapse them/);
    expect(BODY).toMatch(/This call must spend NOTHING/);
    expect(BODY).toMatch(/one\s*\n?\s*contact, one credit/i);
    expect(BODY).toMatch(/Silence is not consent/);
    // …and the real launch, plus polling so it reports only resolved contacts.
    expect(BODY).toMatch(/`confirm: true`/);
    expect(BODY).toMatch(/leadbay_bulk_enrich_status/);
    // …and it must say what that cost.
    expect(BODY).toMatch(/one credit per\s*\n?\s*contact revealed/i);
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
    expect(BODY).toMatch(/never write\s*\n?\s*one you did not receive/i);
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

  it("gate 3 drafts an email and the tour never sends it", () => {
    // The IRON LAW was narrowed when this gate landed: DRAFTING is the point,
    // and nothing leaves the chat — but sending, offering to send, and logging
    // an outreach that never happened all stay forbidden.
    expect(BODY).toMatch(/leadbay_prepare_outreach/);
    expect(BODY).toMatch(/drafts\*\* an email at GATE 3 but never \*\*sends\*\*/i);
    expect(BODY).toMatch(/never offer to send it on their behalf/i);
    expect(BODY).toMatch(/leadbay_report_outreach/);
  });

  it("gate 3 cannot be talked into spending, and invents no recipient", () => {
    // prepare_outreach takes an `enrich` flag that launches a PAID reveal. The
    // user clicked "draft an email", not "spend my credits" — and with no
    // enrichment yet there is no contact NAME, so the draft goes to a title.
    expect(BODY).toMatch(/Never pass `enrich: true`/);
    expect(BODY).toMatch(/Address it to the job TITLE/i);
    expect(BODY).toMatch(/inventing one is fabrication/i);
    // The null email is the hook for gate 4, not a failure to apologise for.
    expect(BODY).toMatch(/nobody to send it to yet/i);
  });

  it("gate 4 is scoped to the lead gate 3 drafted for", () => {
    // One draft → one recipient → one credit. Fanning across the batch loses
    // the thread back to the email the user just watched being written.
    expect(BODY).toMatch(/the one lead you\s*\n?\s*drafted for at GATE 3/i);
    expect(BODY).toMatch(/one\s*\n?\s*contact, one credit/i);
  });

  it("the exit offers Zoe's 1:1, using the manifest's URL", () => {
    // Prompt and manifest are two renderings of one offer — pin the link
    // against the manifest so a reworded prompt can't ship a different one.
    expect(BODY).toContain(GETTING_STARTED_MANIFEST.calendly_url);
    // ONE section owns how the tour ends, with three named endings. The bug
    // this replaced: a separate exit section competing with a CLOSING section,
    // so the agent rendered the cheat-sheet, felt finished, and never made the
    // offer (observed live at gate 2).
    expect(BODY).toMatch(/HOW THE TOUR ENDS — THREE ENDINGS/);
    expect(BODY).toMatch(/This is the ONLY place that says what to do when the\s*\n?\s*walkthrough stops/i);
    // Ending B must state that the offer is required AND last.
    expect(BODY).toMatch(/The 1:1 offer — REQUIRED, and it goes last/i);
    expect(BODY).toMatch(/One sentence and the link/i);
    expect(BODY).toMatch(/Never re-open the walkthrough/i);
    // Ending C gets none of it — their real question is the answer.
    expect(BODY).toMatch(/No cheat-sheet, no setup link, no 1:1\s*\n?\s*offer/i);
  });

  it("the three endings are mutually exclusive and each is complete", () => {
    // The failure mode is picking the wrong one, so each must be named where
    // the agent decides, not buried in prose.
    expect(BODY).toMatch(/## ENDING A — they finished all six gates/);
    expect(BODY).toMatch(/## ENDING B — they picked `I'm done for now`/);
    expect(BODY).toMatch(/## ENDING C — they typed something off-script/);
    // Endings A and B share the cheat-sheet + link; only B carries the offer.
    expect(BODY).toMatch(/## The cheat-sheet \(endings A and B\)/);
    expect(BODY).toMatch(/## The setup guide \(endings A and B\)/);
  });

  it("routes SETUP problems to the docs, and uses the manifest's URL", () => {
    // The third routing branch, alongside overview-prose. A user who can't sign
    // in or whose tools aren't appearing is upstream of gate 1, and no gate can
    // help them. Same drift risk as the gate labels: the prompt hardcodes the
    // URL as prose, so pin it against the manifest rather than trusting both.
    const url = GETTING_STARTED_MANIFEST.docs_url;
    expect(BODY).toContain(url);
    expect(BODY).toMatch(/tools aren't appearing/i);
    expect(BODY).toMatch(/assumes\s*\n?\s*a working connection/i);
  });

  it("shows the setup link exactly twice — the pre-check and the closing", () => {
    // The manifest's docs_note sanctions two moments and forbids the rest. If
    // the prompt grows a third mention, it's a link between gates, which is
    // what the note exists to prevent.
    const url = GETTING_STARTED_MANIFEST.docs_url;
    const hits = BODY.split(url).length - 1;
    expect(hits, `expected the setup link twice, found ${hits}`).toBe(2);
    // …and the second one sits in the CLOSING, after the cheat-sheet.
    expect(BODY.lastIndexOf(url)).toBeGreaterThan(BODY.indexOf("Just say"));
    expect(BODY).toMatch(/Once, here, and nowhere else/i);
  });
});
