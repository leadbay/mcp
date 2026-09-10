/**
 * `title_gate` canonicalization on the qualify idempotency key.
 *
 * With `contact_titles` present the backend applies `prefer` when the field is
 * omitted. The key hashed the omission as `null`, so an approval that left the
 * field out and an unkeyed retry that materialized the same documented default
 * described identical work under two different `qualify-auto-*` keys — and the
 * retry escaped dedupe into a second PAID qualification and channel purchase.
 *
 * The search path already canonicalized this; qualify did not. Same class as
 * the `exploration_cap` fix, same consequence: a double charge on a retry.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

beforeEach(() => resetHttpMock());

/** PAID path — the only one that derives a key. */
async function paidKey(extra: Record<string, unknown>): Promise<string> {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/qualify",
      status: 200,
      body: { job_id: "job-1", state: "queued", items: [] },
    },
    {
      method: "GET",
      path: /^\/1\.6\/mcp\/jobs\//,
      status: 200,
      body: {
        job: { id: "job-1", state: "succeeded" },
        funnel: { delivered: 0, examined: 0 },
        items: [],
      },
    },
  ]);
  await qualifyLeads.execute(newClient(), {
    lead_refs: [{ website: "acme.com" }],
    qualify: true,
    confirm: true,
    wait_seconds: 0,
    ...extra,
  } as any);
  const post = getHttpRequests().find(
    (r) => r.method === "POST" && r.path.endsWith("/mcp/qualify")
  );
  return JSON.parse(post!.body ?? "{}").request_id;
}

describe("leadbay_qualify_leads — title_gate key canonicalization", () => {
  it("an omitted title_gate keys the same as the applied default", async () => {
    const omitted = await paidKey({ contact_titles: ["Head of Ops"] });
    const explicit = await paidKey({
      contact_titles: ["Head of Ops"],
      title_gate: "prefer",
    });
    expect(omitted).toBeTruthy();
    expect(omitted).toEqual(explicit);
  });

  it("an explicit non-default title_gate still keys distinctly", async () => {
    const omitted = await paidKey({ contact_titles: ["Head of Ops"] });
    const strict = await paidKey({
      contact_titles: ["Head of Ops"],
      title_gate: "strict",
    });
    expect(omitted).not.toEqual(strict);
  });

  it("with no contact_titles the default is absent, not 'prefer'", async () => {
    // Nothing to gate on, so the backend applies no gate — canonicalizing to
    // "prefer" here would collapse two genuinely different asks.
    const bare = await paidKey({});
    const prefer = await paidKey({ title_gate: "prefer" });
    expect(bare).not.toEqual(prefer);
  });

  it("matches the search path's rule", async () => {
    // Both tools must materialize the same default, or the same approval
    // hashes differently depending on which tool the agent reached for.
    const a = await paidKey({ contact_titles: ["VP People"] });
    const b = await paidKey({ contact_titles: ["VP People"], title_gate: "prefer" });
    expect(a).toEqual(b);
  });
});
