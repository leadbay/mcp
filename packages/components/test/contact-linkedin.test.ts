import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { contactLinkedin } from "../src/runtime.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";
import { ARTIFACT_TEMPLATES } from "../../core/src/artifact-templates.generated.js";

// On the agent's inline table every contact name is a link to LinkedIn — the
// profile when one is on file, else a people search. The boards printed the
// name as bare text, so the one thing a rep clicks to find the person did
// nothing. lb.contactLinkedin carries the table's rule into the kit, and both
// finished boards use it.

describe("lb.contactLinkedin — the inline table's rule", () => {
  it("links to the profile when linkedin_page is a real https URL", () => {
    expect(
      contactLinkedin({ first_name: "Jane", last_name: "Doe", linkedin_page: "https://www.linkedin.com/in/janedoe" }, "Acme"),
    ).toEqual({ url: "https://www.linkedin.com/in/janedoe", profile: true });
  });

  it("falls back to a people search on name + company, legal suffix stripped", () => {
    const li = contactLinkedin({ first_name: "Jane", last_name: "Doe", linkedin_page: null }, "Acme Holdings, Inc.");
    expect(li).toEqual({
      url: "https://www.linkedin.com/search/results/people/?keywords=Jane+Doe+Acme+Holdings",
      profile: false,
    });
  });

  it("treats the API's literal \"null\" and a non-https value as no profile", () => {
    expect(contactLinkedin({ first_name: "J", linkedin_page: "null" }, "X")!.profile).toBe(false);
    expect(contactLinkedin({ first_name: "J", linkedin_page: "linkedin.com/in/j" }, "X")!.profile).toBe(false);
  });

  it("encodes names and companies safely", () => {
    const li = contactLinkedin({ first_name: "Jean-François", last_name: "Froemer" }, "Café & Co SARL")!;
    expect(li.url).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=Jean-Fran%C3%A7ois+Froemer+Caf%C3%A9+%26+Co",
    );
  });

  it("returns null when the contact has no name", () => {
    expect(contactLinkedin({ first_name: null, last_name: "null" }, "Acme")).toBeNull();
    expect(contactLinkedin(null, "Acme")).toBeNull();
  });
});

// ── The finished boards, run for real ─────────────────────────────────────────

const LEAD = {
  id: "L1",
  name: "Acme SAS",
  score: 80,
  recommended_contact: { first_name: "Jane", last_name: "Doe", job_title: "Head of Ops", linkedin_page: "https://www.linkedin.com/in/janedoe" },
};

function bootTriage(lead: Record<string, unknown>) {
  const calls: string[] = [];
  const dom = new JSDOM(ARTIFACT_TEMPLATES.triage_board.html, {
    runScripts: "dangerously",
    beforeParse(win: any) {
      win.cowork = {
        callMcpTool: async (tool: string) => {
          calls.push(tool);
          if (tool === "leadbay_pull_leads") return { leads: [lead], pagination: { total: 1 } };
          return {};
        },
      };
    },
  });
  return { dom, calls };
}

async function contactLink(lead: Record<string, unknown>): Promise<HTMLAnchorElement | null> {
  const { dom } = bootTriage(lead);
  for (let i = 0; i < 50 && !dom.window.document.querySelector(".lb-card"); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const line = [...dom.window.document.querySelectorAll(".lb-sub")].find((el) => el.textContent?.includes("👤"));
  return (line?.querySelector("a") as HTMLAnchorElement | null) ?? null;
}

describe("the triage board links the contact's name", () => {
  it("to their LinkedIn profile", async () => {
    const a = await contactLink(LEAD);
    expect(a?.textContent).toBe("Jane Doe");
    expect(a?.getAttribute("href")).toBe("https://www.linkedin.com/in/janedoe");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("title")).toBe("Jane Doe on LinkedIn");
  });

  it("to a people search when no profile is on file, and says so", async () => {
    const a = await contactLink({ ...LEAD, recommended_contact: { first_name: "Jane", last_name: "Doe" } });
    expect(a?.getAttribute("href")).toBe("https://www.linkedin.com/search/results/people/?keywords=Jane+Doe+Acme");
    expect(a?.getAttribute("title")).toMatch(/No LinkedIn profile on file/);
  });
});

describe("the route planner and the guide carry the same rule", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const planner = readFileSync(join(here, "../src/templates/route-planner/app.js"), "utf8");

  it("the route planner's lead panel links the contact through the helper", () => {
    expect(planner).toContain("lb.contactLinkedin(contact, lead.name)");
  });

  it("the guide lists the helper and uses it in the card recipe", () => {
    expect(GUIDE).toContain("| `lb.contactLinkedin(contact, company)` |");
    expect(GUIDE).toContain("lb.contactLinkedin(rc, lead.name)");
  });
});
