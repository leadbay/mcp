import { describe, it, expect } from "vitest";
import { buildCallSheetNextSteps } from "../../../src/composite/campaign-call-sheet.js";

// The campaign call sheet returned rows and NOTHING else — no next_steps at
// all, while every other lead-returning tool offers the board first. That is
// backwards: a campaign is already the curated set, so its rows are the most
// ready to be worked of any list in the product.
//
// The lead desk leads the menu here, and its wording varies with the sheet: a
// campaign where most rows have nobody to call needs enrichment before it
// needs a dialer, and promising a board of empty rows wastes the click.

const opt = (ns: ReturnType<typeof buildCallSheetNextSteps>, label: string) =>
  ns?.options.find((o) => o.label === label);

const sheet = (over: Partial<Parameters<typeof buildCallSheetNextSteps>[0]> = {}) =>
  buildCallSheetNextSteps({
    leadCount: 10,
    campaignId: "cmp1",
    leadsWithoutContacts: 0,
    hasMore: false,
    nextPage: null,
    ...over,
  });

describe("the call sheet offers the lead desk first", () => {
  const ns = sheet();

  it("leads the menu with it", () => {
    expect(ns!.options[0].label).toBe("Contact and outreach");
    expect(ns!.options[0].kind).toBe("build_artifact");
  });

  it("names the tool and the recipe, not just 'build an artifact'", () => {
    expect(ns!.options[0].description).toContain("leadbay_get_artifact_runtime");
    expect(ns!.options[0].description).toMatch(/LEAD DESK recipe/);
  });

  it("carries the campaign id, since the desk cannot source without it", () => {
    // lb.leadSource with kind:"campaign" and no id fetches nothing, and the
    // deep link needs it too — omitting `campaign=` opens an empty view.
    expect(ns!.options[0].description).toContain("campaignId `cmp1`");
    expect(ns!.options[0].description).toContain("`campaign`");
  });

  it("builds from the rows in hand rather than re-calling the sheet", () => {
    expect(ns!.options[0].description).toMatch(/do NOT re-call/i);
  });

  it("keeps the label inside the widget's limit", () => {
    expect(ns!.options[0].label.split(/\s+/).length).toBeLessThanOrEqual(5);
  });
});

describe("a sheet with nobody to call says so", () => {
  const ns = sheet({ leadCount: 10, leadsWithoutContacts: 8 });

  it("tells the desk to lead with enrich", () => {
    expect(ns!.options[0].description).toMatch(/lead with the enrich control/i);
  });

  it("replaces prep-outreach with an enrichment offer, naming the count", () => {
    expect(opt(ns, "Prep outreach")).toBeUndefined();
    const enrich = opt(ns, "Enrich the campaign");
    expect(enrich).toBeDefined();
    expect(enrich!.description).toContain("8 of 10");
  });

  it("a workable sheet keeps prep outreach instead", () => {
    const ok = sheet({ leadCount: 10, leadsWithoutContacts: 2 });
    expect(opt(ok, "Prep outreach")).toBeDefined();
    expect(opt(ok, "Enrich the campaign")).toBeUndefined();
    expect(ok!.options[0].description).not.toMatch(/lead with the enrich/i);
  });
});

describe("the menu stays valid", () => {
  it("offers the next page only when one exists", () => {
    expect(opt(sheet({ hasMore: true, nextPage: 1 }), "Next page")).toBeDefined();
    expect(opt(sheet(), "Next page")).toBeUndefined();
  });

  it("never exceeds the widget's four options", () => {
    const full = sheet({ hasMore: true, nextPage: 1, leadsWithoutContacts: 9 });
    expect(full!.options.length).toBeLessThanOrEqual(4);
    // …and the desk is never the one trimmed.
    expect(full!.options[0].label).toBe("Contact and outreach");
  });

  it("stays at or above the widget's two-option floor", () => {
    expect(sheet()!.options.length).toBeGreaterThanOrEqual(2);
  });

  it("offers nothing for an empty sheet", () => {
    expect(sheet({ leadCount: 0 })).toBeNull();
  });
});
