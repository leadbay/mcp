import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The surface rules the finished boards follow, written where an agent that
// builds any other board reads them — so a hand-built board loads once, sizes
// itself in an MCP Apps frame, and speaks French too, instead of only the two
// templates doing so.

const flat = GUIDE.replace(/\s+/g, " ");

describe("the guide carries the surface rules", () => {
  it("lists the three surface helpers", () => {
    expect(GUIDE).toContain("`lb.openingResult({ timeoutMs? })`");
    expect(GUIDE).toContain("`lb.locale()`");
    expect(GUIDE).toContain("`lb.i18n({ en: {...}, fr: {...} })`");
  });

  it("has the four rules, in a section of their own", () => {
    expect(GUIDE).toContain("## One page, three surfaces");
    expect(flat).toMatch(/Never hard-wire one host's runtime/);
    expect(flat).toMatch(/\*\*Load once\.\*\*/);
    expect(flat).toMatch(/\*\*Size for the frame\.\*\*/);
    expect(flat).toMatch(/\*\*Label in the viewer's language\.\*\*/);
    expect(GUIDE).toContain(':root[data-lb-surface="mcp-app"] .app');
  });

  it("both finished-board recipes say what they do as MCP Apps views", () => {
    expect(flat).toMatch(/the view `leadbay_pull_leads` opens in the chat/);
    expect(flat).toMatch(/the view `leadbay_followups_map` opens in the chat/);
  });
});
