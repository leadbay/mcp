/**
 * The input schemas advertise the limits the backend enforces, so the agent
 * sees them before its first call instead of learning them from a 400.
 *
 * Each limit below was learned the expensive way in production:
 *   - lens `name` / `description` over 255 chars: Sentry MCP-K (500, 7-8 Sep)
 *     and MCP-4D (400, 14 Sep). Backend: LensesRoutes.kt requireMaxLength.
 *   - a qualification question over 255 chars: Sentry MCP-4E (14 Sep).
 *     Backend: OrganizationsRoutes.kt requireMaxLength per question.
 *   - `min_ai_score` outside [-30, 30] and more than 10 `contact_titles`:
 *     Sentry MCP-3Y, four events 10-12 Sep, from /mcp/search.
 */

import { describe, expect, it } from "vitest";
import { newLens } from "../../../src/composite/new-lens.js";
import { setQualificationQuestions } from "../../../src/composite/set-qualification-questions.js";
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const props = (tool: { inputSchema: unknown }) =>
  (tool.inputSchema as { properties: Record<string, any> }).properties;

describe("input schemas declare the backend's limits", () => {
  it("leadbay_new_lens: name and description are at most 255 characters", () => {
    expect(props(newLens).name.maxLength).toBe(255);
    expect(props(newLens).description.maxLength).toBe(255);
  });

  it("leadbay_set_qualification_questions: each written question is at most 255 characters", () => {
    expect(props(setQualificationQuestions).questions.items.maxLength).toBe(255);
    expect(props(setQualificationQuestions).add.items.maxLength).toBe(255);
  });

  it("leadbay_find_new_leads: min_ai_score within [-30, 30], at most 10 contact_titles", () => {
    expect(props(findNewLeads).min_ai_score).toMatchObject({ minimum: -30, maximum: 30 });
    expect(props(findNewLeads).contact_titles.maxItems).toBe(10);
  });
});
