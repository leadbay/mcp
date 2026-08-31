import { describe, expect, it } from "vitest";
import { getContacts } from "@leadbay/core";
import { leadbay_get_contacts } from "@leadbay/core/dist/tool-descriptions.generated.js";
import { buildServerInstructions } from "../../src/server.js";

// product#4004. The backend already distinguishes a failed enrichment from one
// still in flight; nothing in the MCP said so, and scheduled agents re-attempted
// the same terminal contacts on every run forever. These assertions drive the
// three surfaces an agent actually receives — the server instructions it reads
// on every session, the generated tool description, and the outputSchema a
// structured client consumes — not the templates behind them.

const WITH_ENRICH = new Set([
  "leadbay_account_status",
  "leadbay_pull_leads",
  "leadbay_research_lead_by_id",
  "leadbay_enrich_titles",
]);

const WITHOUT_ENRICH = new Set([
  "leadbay_account_status",
  "leadbay_pull_leads",
  "leadbay_research_lead_by_id",
]);

describe("audit: settled-empty enrichment is named as terminal (product#4004)", () => {
  describe("server instructions", () => {
    it("tells the agent a settled-empty enrichment is terminal when enrich_titles is exposed", () => {
      const out = buildServerInstructions(WITH_ENRICH);
      expect(out).toMatch(/settled-empty enrichment is TERMINAL/i);
      expect(out).toMatch(/do not re-attempt it on a later run/i);
      // The pair, not either half — this is the whole point of the paragraph.
      expect(out).toMatch(/enrichment\.done: true/);
      expect(out).toMatch(/enrichment\.credits_used: 0/);
    });

    it("guards both halves of the pair against being read alone", () => {
      const out = buildServerInstructions(WITH_ENRICH);
      // credits_used:0 is what an IN-FLIGHT reservation reports too — observed
      // live on staging: {done:false, credits_used:0, email_requested:true}.
      expect(out).toMatch(/in-flight reservation reports/i);
      // The type marks credits_used optional; absent must not read as zero.
      expect(out).toMatch(/ABSENT `credits_used` means the cost is unknown, not zero/i);
      // enrichment:null is "never requested", not "in flight".
      expect(out).toMatch(/`enrichment: null` is a different state/i);
    });

    it("stays out of the instructions when enrich_titles is not exposed", () => {
      // #3504: never instruct the agent to call a tool the server didn't register.
      const out = buildServerInstructions(WITHOUT_ENRICH);
      expect(out).not.toMatch(/settled-empty enrichment is TERMINAL/i);
    });
  });

  describe("leadbay_get_contacts description", () => {
    it("documents all four enrichment states", () => {
      expect(leadbay_get_contacts).toMatch(/Never requested/i);
      expect(leadbay_get_contacts).toMatch(/Reservation in flight/i);
      expect(leadbay_get_contacts).toMatch(/Settled, found nothing/i);
      expect(leadbay_get_contacts).toMatch(/Terminal\. Stop\./i);
    });

    it("guards the optional credits_used and the null-vs-false distinction", () => {
      expect(leadbay_get_contacts).toMatch(
        /absent `credits_used` is unknown, not zero/i,
      );
      expect(leadbay_get_contacts).toMatch(
        /missing or `null` `enrichment` is not the same as `done: false`/i,
      );
    });

    it("says where a resolved channel actually lands", () => {
      // Observed live: after a reveal the paid record keeps enrichment
      // {done:true, credits_used:1} and NO email; the channel appears on the
      // org-source twin. A doc that said "read email here" would teach a new
      // misread — a resolved contact would look failed.
      expect(leadbay_get_contacts).toMatch(/org-source twin/i);
      expect(leadbay_get_contacts).toMatch(/is RESOLVED, not failed/i);
    });
  });

  describe("leadbay_get_contacts outputSchema", () => {
    const schema = getContacts.outputSchema as any;

    it("exists and describes the enrichment block", () => {
      expect(schema).toBeDefined();
      const enrichment =
        schema.properties.contacts.items.properties.enrichment;
      expect(enrichment.type).toEqual(["object", "null"]);
      expect(enrichment.description).toMatch(/TERMINAL/);
      expect(enrichment.description).toMatch(/NEVER requested/);
    });

    it("marks credits_used as meaningful only alongside done:true", () => {
      const props =
        schema.properties.contacts.items.properties.enrichment.properties;
      expect(props.credits_used.description).toMatch(/Only meaningful when done:true/i);
      expect(props.credits_used.description).toMatch(/when absent the cost is unknown/i);
      expect(props.done.description).toMatch(/reservation in flight/i);
    });

    it("keeps _fetch_errors in the schema so an empty list is not read as 'no contacts'", () => {
      expect(schema.properties._fetch_errors).toBeDefined();
      expect(schema.properties._fetch_errors.description).toMatch(
        /fetch failure, NOT 'no contacts'/,
      );
    });
  });
});
