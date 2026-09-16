/**
 * product#4145 — the `resolution: "not_found"` payload itself.
 *
 * The wire-level proof lives in
 * packages/mcp/test/research-not-found-is-an-answer.test.ts. This file pins
 * what the payload has to carry for the agent to act on it: the sentence to
 * say, the field to ask for, and — on the lens-scoped miss, where no field the
 * user could supply would help — an empty `would_help` with the real remedy in
 * `next_step`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpRequests,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadByNameFuzzy } from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

beforeEach(() => resetHttpMock());

const suggestMiss = (q: string) => ({
  method: "GET" as const,
  path: `/1.6/search/suggest?q=${encodeURIComponent(q)}`,
  status: 200,
  body: [],
});

describe("research_lead_by_name_fuzzy — the not_found payload", () => {
  it("names the field to ask for and the sentence to say", async () => {
    mockHttp([
      suggestMiss("Wink Lab"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["website"] },
      },
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Wink Lab",
    });

    expect(res.resolution).toBe("not_found");
    expect(res.query).toBe("Wink Lab");
    expect(res.would_help).toEqual(["website"]);
    expect(res.summary).toBe(
      'No company matching "Wink Lab" in your visible Leadbay leads and in the Leadbay company registry'
    );
    expect(res.next_step).toContain("the company website for `website`");
    expect(res.next_step).toContain("Do not offer an import before asking");
    expect(res._meta).toMatchObject({ region: "fr", resolved_from: "resolver" });
  });

  it("carries the resolver's own vocabulary when the input was unidentifiable", async () => {
    mockHttp([
      suggestMiss("Hugo Flusin"),
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "unidentifiable", reason: "input names a person" },
      },
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Hugo Flusin",
    });

    expect(res.resolution).toBe("not_found");
    expect(res.next_step).toContain("input names a person");
    expect(res.would_help).toEqual(["website", "registry_number"]);
  });

  it("asks for nothing when the miss was a lens scope — the remedy is to drop it", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/lenses/55/leads/wishlist?q=Wink%20Lab&count=50&page=0&contacts=false",
        status: 200,
        body: { items: [], pagination: { page: 0, pages: 0, total: 0 } },
      },
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(newClient(), {
      companyName: "Wink Lab",
      lensId: 55,
    });

    expect(res.resolution).toBe("not_found");
    expect(res.would_help).toEqual([]);
    expect(res.summary).toBe('No lead matching "Wink Lab" in lens 55');
    expect(res.next_step).toContain("Omit lensId");
    expect(res._meta).toMatchObject({ region: "fr", lens_id: 55 });
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("still throws when only the registry answered — that lookup did not complete", async () => {
    const down = Object.assign(new Error("dns"), { code: "ENOTFOUND" });
    mockHttp([
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["registry_number"] },
      },
      { method: "GET", path: "/1.6/search/suggest?q=Wink%20Lab", status: 0, error: down },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), {
        companyName: "Wink Lab",
        website: "wink-lab.com",
      })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
      hint: expect.stringContaining("this lookup did not complete"),
    });
  });
});
