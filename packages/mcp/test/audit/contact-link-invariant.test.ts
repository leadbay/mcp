/**
 * Regression audit for the "every contact name MUST be a markdown link" rule.
 *
 * The invariant: in every tool that surfaces contact data (pull_leads,
 * pull_followups, followups_map, research_lead_by_id, research_lead_by_name_fuzzy,
 * prepare_outreach, recall_ordered_titles), the agent must render contact names
 * as `[Name](URL)` markdown links — using `contact.linkedin_page` when set,
 * or a constructed `linkedin.com/search/results/people/?keywords=…` URL
 * otherwise. A bare-text contact name is a regression: the host's link
 * styling is the user's primary affordance for "who is this person".
 *
 * History (2026-05-20): the agent started rendering plain-text contact
 * names for any row whose `linkedin_page` was null. Root cause: the
 * snippet's "When … link … Otherwise fall back …" framing read as a
 * two-option choice, and the agent picked plain text. Fix landed in the
 * same commit as this audit; the audit prevents the imperative wording
 * from being softened back into a conditional.
 *
 * This is a deterministic source-side audit — it does NOT exercise the
 * LLM. The expensive end-to-end check (running the agent against a
 * scenario fixture and grepping its final_agent_message for unlinked
 * contact names) lives in test/eval/invariants/* and is gated behind
 * LEADBAY_EVAL=1. Together they form the defense: this audit catches
 * regressions in the SOURCE prompts; the eval invariant catches drift
 * in the LLM's interpretation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const SNIPPET_PATH = resolve(
  REPO_ROOT,
  "packages/promptforge/snippets/linking/contact-linkedin.md"
);

// Every tool that returns a `recommended_contact`, `contacts.reachable`,
// or any other contact-bearing field. If you add a new contact-rendering
// tool, add its identifier here. The audit will refuse to silently let a
// new tool skip the always-link rule.
//
// Intentionally excluded:
//   - leadbay_list_previously_enriched_titles — returns job-title strings only,
//     no contact identities, so the always-link rule doesn't apply.
const TOOLS_THAT_RENDER_CONTACTS = [
  "leadbay_pull_leads",
  "leadbay_pull_followups",
  "leadbay_followups_map",
  "leadbay_research_lead_by_id",
  "leadbay_research_lead_by_name_fuzzy",
  "leadbay_prepare_outreach",
] as const;

describe("audit: contact-name-MUST-be-a-markdown-link invariant", () => {
  it("the contact-linkedin snippet carries the MANDATORY directive", () => {
    const src = readFileSync(SNIPPET_PATH, "utf8");
    // Three structural pieces that together make the rule unambiguous to
    // the agent. If any is dropped, the agent regresses to plain-text
    // contact names — proven by the 2026-05-20 incident.
    expect(src).toMatch(/MANDATORY/);
    expect(src).toMatch(/MUST be wrapped in markdown link syntax/i);
    expect(src).toMatch(/Never render a contact name as bare text/i);
    // The fallback URL must remain documented; without it the agent has
    // no constructable link when linkedin_page is null.
    expect(src).toMatch(
      /linkedin\.com\/search\/results\/people\/\?keywords=/
    );
  });

  it.each(TOOLS_THAT_RENDER_CONTACTS)(
    "%s description includes the MANDATORY contact-link rule",
    (toolName) => {
      const desc = (Generated as Record<string, string>)[toolName];
      expect(
        desc,
        `tool ${toolName} is missing from generated descriptions — add it, or remove it from TOOLS_THAT_RENDER_CONTACTS in this audit if it no longer surfaces contacts`
      ).toBeTruthy();

      // The agent reads the bundled description. The mandate MUST land
      // somewhere inside it — either via {{include:linking/contact-linkedin}}
      // (the normal path) or written inline. Either way, the imperative
      // phrase must reach the agent.
      expect(
        desc,
        `${toolName} description has lost the always-link mandate; re-add {{include:linking/contact-linkedin}} (or equivalent) to the tool's template`
      ).toMatch(/MUST be wrapped in markdown link syntax/i);
      expect(desc).toMatch(/Never render a contact name as bare text/i);
    }
  );

  it("the constructed people-search URL pattern is documented in every contact-rendering tool", () => {
    for (const toolName of TOOLS_THAT_RENDER_CONTACTS) {
      const desc = (Generated as Record<string, string>)[toolName];
      expect(
        desc,
        `${toolName} doesn't document the linkedin.com/search/results/people fallback URL; the agent has no way to construct a link when linkedin_page is null and will regress to plain text`
      ).toMatch(/linkedin\.com\/search\/results\/people\/\?keywords=/);
    }
  });
});
