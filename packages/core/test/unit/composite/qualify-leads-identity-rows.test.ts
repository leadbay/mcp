/**
 * product#4131 — a free identity pass over a list of companies answers with
 * one compact row per company and the counts of what Leadbay has.
 *
 * FR prod, 2026-09-15: 82 broker names through leadbay_qualify_leads with
 * qualify:false returned 269,505 characters, because `items` repeated every
 * lead `leads` also carried, each with the whole QualifiedLead.
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
import { leadJobStatus } from "../../../src/composite/lead-job-status.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "fr");

const JOB_ID = "ffbd024f-589e-47f9-b03c-2726f8c239e5";
const uuid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

// Sized like the real payload: about 6.6 KB of research per delivered lead.
function delivered(
  i: number,
  seq: number,
  opts: { website?: string; linkedin?: string } = {}
) {
  return {
    ref: {
      input_indexes: [i],
      lead_id: uuid(i),
      requested_as: { name: `BROKER ${i}` },
    },
    status: "delivered",
    seq,
    completed_at: "2026-09-15T10:00:00Z",
    cost: { billed: 0, unit: "cost_cents" },
    from_cache: { web_fetch: false },
    lead: {
      lead_id: uuid(i),
      company: {
        name: `BROKER ${i} SARL`,
        website: opts.website,
        socials: opts.linkedin ? { linkedin: opts.linkedin } : undefined,
        employees: { known: false },
        location: { city: "Lyon", country: "FR" },
        description: "Courtier en assurances. ".repeat(25),
        website_properties: { value_proposition: "v".repeat(2000) },
        provenance: { source: "registry" },
      },
      fit: { available: false },
      web_research: { available: true, summary: "r".repeat(3500) },
      contact: null,
    },
  };
}

function skipped(i: number, seq: number, reason: string) {
  return {
    ref: { input_indexes: [i], requested_as: { name: `BROKER ${i}` } },
    status: "skipped",
    status_reason: reason,
    seq,
    cost: { billed: 0, unit: "cost_cents" },
  };
}

function snapshot(items: unknown[], state = "completed", nextSince: string | null = null) {
  return {
    job: {
      id: JOB_ID,
      state,
      submitted_at: "2026-09-15T10:00:00Z",
      expires_at: "2026-10-15T10:00:00Z",
      last_progress_at: "2026-09-15T10:00:04Z",
    },
    funnel: { delivered: 0, stop_reason: null },
    items,
    next_since: nextSince,
    cost: { spent: 0, unit: "cost_cents", breakdown: {} },
    explain: { region: "FR", model: "m", scope_notes: [] },
  };
}

const submit = (n: number) => ({
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 0, unit: "cost_cents" },
  items_requested: n,
  duplicate: false,
});

const names = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `BROKER ${i}` }));

beforeEach(() => resetHttpMock());

describe("leadbay_qualify_leads — identity pass over a list", () => {
  it("answers one row per company, in the user's order, with what Leadbay has", async () => {
    // Emitted out of the user's order, as the backend does.
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: submit(4) },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot([
          skipped(3, 0, "not_in_universe"),
          delivered(0, 1, {
            website: "acta-credit.fr",
            linkedin: "https://www.linkedin.com/company/acta-credit",
          }),
          skipped(2, 2, "low_confidence_identity"),
          delivered(1, 3),
        ]),
      },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: names(4),
      qualify: false,
      wait_seconds: 0,
    });

    expect(result.rows.map((r: any) => r.input)).toEqual([
      "BROKER 0",
      "BROKER 1",
      "BROKER 2",
      "BROKER 3",
    ]);
    expect(result.rows[0]).toEqual({
      input_indexes: [0],
      input: "BROKER 0",
      status: "delivered",
      lead_id: uuid(0),
      name: "BROKER 0 SARL",
      website: "acta-credit.fr",
      linkedin: "https://www.linkedin.com/company/acta-credit",
    });
    expect(result.rows[1]).toMatchObject({ website: null, linkedin: null });
    expect(result.rows[2]).toEqual({
      input_indexes: [2],
      input: "BROKER 2",
      status: "skipped",
      status_reason: "low_confidence_identity",
    });
    expect(result.summary).toMatchObject({
      refs_submitted: 4,
      resolved: 2,
      ambiguous: 1,
      not_found: 1,
      other_skipped: 0,
      with_website: 1,
      with_linkedin: 1,
      without_website: 1,
    });
    // No lead is carried twice, or at all.
    expect(result.items).toBeUndefined();
    expect(result.leads).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.done).toBe(true);
    expect(result.next_poll).toBeNull();

    const post = getHttpRequests().find((r) => r.method === "POST")!;
    expect(JSON.parse(post.body!).qualify).toBe(false);
  });

  it("82 brokers fit in a chat: 60 found, 18 unclear, 2 not found, 5 with a website", async () => {
    // The shape of job ffbd024f on FR prod.
    const items = [
      ...Array.from({ length: 60 }, (_, i) =>
        delivered(i, i, i < 5 ? { website: `broker${i}.fr` } : {})
      ),
      ...Array.from({ length: 18 }, (_, k) => skipped(60 + k, 60 + k, "low_confidence_identity")),
      skipped(78, 78, "not_in_universe"),
      skipped(79, 79, "not_in_universe"),
      skipped(80, 80, "pending_import"),
      skipped(81, 81, "pending_import"),
    ];
    const raw = snapshot(items);
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: submit(82) },
      { method: "GET", path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`, status: 200, body: raw },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: names(82),
      qualify: false,
      wait_seconds: 0,
    });

    expect(JSON.stringify(raw).length).toBeGreaterThan(400_000);
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
    expect(result.rows).toHaveLength(82);
    expect(result.summary).toMatchObject({
      resolved: 60,
      ambiguous: 18,
      not_found: 2,
      other_skipped: 2,
      with_website: 5,
      with_linkedin: 0,
      without_website: 55,
    });
  });

  it("past 100 rows it carries 100, and leadbay_lead_job_status pages the rest in the same order", async () => {
    // Emitted in REVERSE input order across two backend pages, so the first
    // page holds inputs 149..50 and the second 49..0.
    const items = Array.from({ length: 150 }, (_, seq) => delivered(149 - seq, seq));
    const pages = () => [
      {
        method: "GET" as const,
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot(items.slice(0, 100), "completed", "c1"),
      },
      {
        method: "GET" as const,
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100&since=c1`,
        status: 200,
        body: snapshot(items.slice(100), "completed", "c2"),
      },
    ];
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: submit(150) },
      ...pages(),
    ]);

    const first: any = await qualifyLeads.execute(newClient(), {
      lead_refs: names(150),
      qualify: false,
      wait_seconds: 0,
    });

    expect(first.rows).toHaveLength(100);
    expect(first.rows[0].input_indexes).toEqual([0]);
    expect(first.rows[99].input_indexes).toEqual([99]);
    expect(first.rows_total).toBe(150);
    expect(first.summary.resolved).toBe(150);
    expect(first.next_poll).toEqual({
      tool: "leadbay_lead_job_status",
      job_id: JOB_ID,
      compact: true,
      offset: 100,
      suggested_wait_seconds: 0,
    });

    resetHttpMock();
    mockHttp(pages());
    const rest: any = await leadJobStatus.execute(newClient(), {
      job_id: JOB_ID,
      compact: true,
      offset: first.next_poll.offset,
    });

    expect(rest.rows).toHaveLength(50);
    expect(rest.rows[0].input_indexes).toEqual([100]);
    expect(rest.rows[49].input_indexes).toEqual([149]);
    expect(rest.rows_offset).toBe(100);
    expect(rest.summary.resolved).toBe(150);
    expect(rest.next_poll).toBeNull();
    expect(rest.leads).toBeUndefined();
  });

  it("a job still running is read again from the top on the next poll", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: submit(3) },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot([delivered(1, 0)], "running"),
      },
    ]);

    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: names(3),
      qualify: false,
      wait_seconds: 0,
    });

    expect(result.still_running).toBe(true);
    expect(result.next_poll).toMatchObject({
      compact: true,
      offset: 0,
      suggested_wait_seconds: 60,
    });
  });

  it("contact titles and prior_deliveries still get the full leads", async () => {
    for (const extra of [
      { contact_titles: ["Gérant"] },
      { prior_deliveries: { job_id: JOB_ID } },
    ]) {
      resetHttpMock();
      mockHttp([
        { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: submit(1) },
        {
          method: "GET",
          path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
          status: 200,
          body: snapshot([delivered(0, 0)]),
        },
      ]);
      const result: any = await qualifyLeads.execute(newClient(), {
        lead_refs: names(1),
        qualify: false,
        wait_seconds: 0,
        ...extra,
      });
      expect(result.rows).toBeUndefined();
      expect(result.leads).toHaveLength(1);
    }
  });
});

describe("leadbay_lead_job_status — compact", () => {
  it("reads the whole job even when a since cursor is passed", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: snapshot([delivered(0, 0, { website: "a.fr" })]),
      },
    ]);

    const result: any = await leadJobStatus.execute(newClient(), {
      job_id: JOB_ID,
      since: "c9",
      compact: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.summary.with_website).toBe(1);
    const paths = getHttpRequests().map((r) => r.path);
    expect(paths).toEqual([`/1.6/mcp/jobs/${JOB_ID}?limit=100`]);
  });
});
