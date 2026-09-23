import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// Any tool that hands back a batch of leads should offer the interactive board
// — a rep who asks "find me 10 gyms near Dallas" wants to work those rows just
// as much as one who asks for today's Discover batch. Only pull_leads offered
// it, so the same request phrased differently produced a markdown table and no
// way to act on it.
//
// These read the SNIPPET SOURCES rather than the generated descriptions: the
// snippets are what an author edits, and a missing offer there is the defect.

const here = dirname(fileURLToPath(import.meta.url));
const snippets = join(here, "../../promptforge/snippets/next-steps");
const read = (name: string) => readFileSync(join(snippets, `${name}.md`), "utf8");

const BATCH_TOOLS = [
  ["pull-leads", /interactive lead triage board/i],
  ["find-new-leads", /interactive lead triage board/i],
  ["pull-followups", /interactive board to contact/i],
] as const;

describe("every lead-batch tool offers the board", () => {
  for (const [snippet, label] of BATCH_TOOLS) {
    it(`${snippet} offers a named, concrete board`, () => {
      const md = read(snippet);
      expect(md).toMatch(label);
      // "artifact" alone is the generic label WORKFLOWS.md rejects.
      expect(md).toMatch(/board/i);
    });

    it(`${snippet} routes the offer through leadbay_get_artifact_runtime`, () => {
      expect(read(snippet)).toContain("leadbay_get_artifact_runtime");
    });

    it(`${snippet} builds from data in hand, not a re-call`, () => {
      // Re-calling to populate a board doubles the request for no new data.
      expect(read(snippet).replace(/\s+/g, " ")).toMatch(/data in hand/i);
    });
  }

  it("pull-leads and find-new-leads offer it FIRST", () => {
    // Discovery batches: triaging the rows is the next move. Follow-ups differ
    // — prepping outreach for the top row leads there, so the board is second.
    for (const snippet of ["pull-leads", "find-new-leads"]) {
      const rows = read(snippet).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Observation") && !l.startsWith("|---"));
      expect(rows[0]).toMatch(/triage board/i);
      expect(rows[0]).toMatch(/offer FIRST/i);
    }
  });

  it("pull-followups keeps outreach prep at the top, board second", () => {
    const rows = read("pull-followups").split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Observation") && !l.startsWith("|---"));
    expect(rows[0]).toMatch(/Prep outreach/i);
    expect(rows[1]).toMatch(/board to contact/i);
  });
});

describe("the recipe covers every batch source", () => {
  const flat = GUIDE.replace(/\s+/g, " ");

  it("names all four tools that can seed a board", () => {
    for (const tool of [
      "leadbay_pull_leads",
      "leadbay_find_new_leads",
      "leadbay_pull_followups",
      "leadbay_campaign_call_sheet",
    ]) {
      expect(flat).toContain(tool);
    }
  });

  it("states what changes with the source, so the board is not re-invented", () => {
    // The deep link's view and which write leads the card — everything else is
    // identical, which is the whole point of a canonical recipe.
    expect(flat).toMatch(/Two things change with the source/i);
    expect(flat).toMatch(/a call board links to\s*`?monitor`?/i);
    expect(flat).toMatch(/A discovery batch is triaged/i);
  });

  it("still forbids re-calling the tool to populate the board", () => {
    expect(flat).toMatch(/never re-call the tool that produced\s*the batch/i);
  });
});
