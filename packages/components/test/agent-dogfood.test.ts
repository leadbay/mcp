import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// END-TO-END DOGFOOD — "can a user agent actually leverage the kit?"
//
// The fixture is HTML an INDEPENDENT agent produced from nothing but the
// leadbay_artifact_kit usage guide (the view-model API). Here we run that exact
// artifact: inject the REAL shipped runtime where the agent placed its marker,
// stub the cowork bridge, and assert the data lifecycle the kit is FOR:
//   1. the campaign <select> POPULATES its options from leadbay_list_campaigns
//   2. "Log call" submits report_outreach with bound status+note AND the baked
//      verification + _triggered_by
//   3. "Add to campaign" submits the picked campaign_id + _triggered_by
//   4. 👍 submits like_lead
// Green here = an agent built a working, API-backed artifact against the kit.

const ROOT = process.cwd(); // packages/components when vitest runs
const FIXTURE = resolve(ROOT, "test/fixtures/agent-call-sheet.html");
const GENERATED = resolve(ROOT, "../core/src/artifact-runtime.generated.ts");

const ACME = "11111111-1111-1111-1111-111111111111";
const GLOBEX = "22222222-2222-2222-2222-222222222222";

function shippedRuntime(): string {
  const src = readFileSync(GENERATED, "utf8");
  const m = src.match(/ARTIFACT_RUNTIME: string = ("(?:[^"\\]|\\.)*");/);
  if (!m) throw new Error("ARTIFACT_RUNTIME not found in generated module");
  return JSON.parse(m[1]) as string;
}

interface Call {
  tool: string;
  args: Record<string, any>;
}

function boot() {
  const html = readFileSync(FIXTURE, "utf8").replace(
    "<!-- RUNTIME_HERE -->",
    `<script>${shippedRuntime()}</script>`,
  );
  const calls: Call[] = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as any).cowork = {
        callMcpTool: (tool: string, args: Record<string, any>) => {
          calls.push({ tool, args });
          // Realistic-ish envelopes; the runtime normalizes structuredContent.
          if (tool === "leadbay_list_campaigns") {
            return Promise.resolve({
              structuredContent: {
                campaigns: [
                  { id: "camp-q3", name: "Q3 Outbound" },
                  { id: "camp-react", name: "Reactivation" },
                ],
              },
            });
          }
          return Promise.resolve({ structuredContent: { ok: true, added: 1, already_present: 0 } });
        },
      };
    },
  });
  const doc = dom.window.document;
  const card = (lead: string) => doc.querySelector(`section.lead-card[data-lead="${lead}"]`) as HTMLElement;
  return { dom, calls, doc, card };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const last = (calls: Call[], tool: string) => [...calls].reverse().find((c) => c.tool === tool);

describe("agent-built call sheet drives the real view-model bus", () => {
  it("populates the campaign <select> options FROM leadbay_list_campaigns", async () => {
    const { doc, calls } = boot();
    await tick();
    const sel = doc.getElementById("campaign") as HTMLSelectElement;
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([
      ["camp-q3", "Q3 Outbound"],
      ["camp-react", "Reactivation"],
    ]);
    // and the load carried the provenance the agent supplied
    expect(last(calls, "leadbay_list_campaigns")?.args._triggered_by).toBeTruthy();
  });

  it("Log call → report_outreach with bound status + note + verification + _triggered_by", async () => {
    const { calls, card } = boot();
    await tick();
    const c = card(ACME);
    const status = c.querySelector("select.status") as HTMLSelectElement;
    const note = c.querySelector("textarea.note") as HTMLTextAreaElement;
    status.value = "INTEREST_VALIDATED_OR_MEETING_PLANED";
    status.dispatchEvent(new (c.ownerDocument.defaultView as any).Event("change"));
    note.value = "Spoke with Jane, booked a demo";
    note.dispatchEvent(new (c.ownerDocument.defaultView as any).Event("input"));
    (c.querySelector("button.log-call") as HTMLButtonElement).click();
    await tick();

    const call = last(calls, "leadbay_report_outreach")!;
    expect(call.args.lead_id).toBe(ACME);
    expect(call.args.epilogue_status).toBe("INTEREST_VALIDATED_OR_MEETING_PLANED");
    expect(call.args.note).toBe("Spoke with Jane, booked a demo");
    expect(call.args.verification?.source).toBe("user_confirmed");
    expect(typeof call.args.verification?.ref).toBe("string");
    expect(typeof call.args._triggered_by).toBe("string");
    expect(call.args._triggered_by.length).toBeGreaterThan(0);
  });

  it("Log call is BLOCKED until the required note is filled", async () => {
    const { calls, card } = boot();
    await tick();
    const c = card(GLOBEX);
    (c.querySelector("button.log-call") as HTMLButtonElement).click(); // no note yet
    await tick();
    expect(calls.some((x) => x.tool === "leadbay_report_outreach")).toBe(false);
  });

  it("Add to campaign → add_leads_to_campaign with the picked campaign_id + _triggered_by", async () => {
    const { calls, card } = boot();
    await tick(); // campaign options load + default to first
    const c = card(ACME);
    (c.querySelector("button.add-campaign") as HTMLButtonElement).click();
    await tick();

    const call = last(calls, "leadbay_add_leads_to_campaign")!;
    expect(call.args.campaign_id).toBe("camp-q3"); // defaulted-to-first picked value
    expect(call.args.lead_ids).toEqual([ACME]);
    expect(typeof call.args._triggered_by).toBe("string");
  });

  it("👍 → like_lead {lead_id}", async () => {
    const { calls, card } = boot();
    await tick();
    (card(GLOBEX).querySelector("button.like") as HTMLButtonElement).click();
    await tick();
    expect(last(calls, "leadbay_like_lead")?.args).toEqual({ lead_id: GLOBEX });
  });
});
