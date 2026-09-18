/**
 * pull_followups offers the daily mailbox sync when most of the page has no
 * outreach logged, because "who was contacted, when, who went quiet" cannot be
 * answered from an empty record (product#4174).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullFollowups } from "../../../src/composite/pull-followups.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

beforeEach(() => resetHttpMock());

const lead = (id: string, loggedAt: string | null) => ({
  id,
  name: `Company ${id}`,
  ...(loggedAt ? { last_prospecting_action: "CREATE_LEAD_NOTE", last_prospecting_action_at: loggedAt } : {}),
});

function monitor(items: object[]) {
  mockHttp([
    { method: "GET", path: "/1.6/monitor/filter", status: 200, body: { criteria: [] } },
    {
      method: "GET",
      path: /\/1\.6\/monitor\?/,
      status: 200,
      body: { items, pagination: { page: 0, pages: 1, total: items.length } },
    },
  ]);
}

describe("pull_followups outreach sync offer", () => {
  it("offers the sync when most leads have no outreach logged", async () => {
    monitor([lead("a", null), lead("b", null), lead("c", "2026-09-01T10:00:00Z")]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r.outreach_sync).toContain("no outreach logged for 2 of the 3 leads");
    expect(r.outreach_sync).toContain("leadbay_report_outreach");
    expect(r.outreach_sync).toContain("daily task with that instruction word for word");
  });

  it("no offer when half the page or more is logged", async () => {
    monitor([lead("a", null), lead("b", "2026-09-01T10:00:00Z")]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r).not.toHaveProperty("outreach_sync");
  });

  it("no offer on an empty page", async () => {
    monitor([]);

    const r: any = await pullFollowups.execute(newClient(), {});

    expect(r).not.toHaveProperty("outreach_sync");
  });
});
