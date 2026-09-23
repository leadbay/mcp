/**
 * leadbay_render_guide — the presentation half of a description, served on
 * demand.
 *
 * `{{render}}` cuts the layout out of a tool description because Claude Code
 * truncates descriptions at 2,048 characters. This tool is how the agent gets
 * that layout back, so the cases that matter are: it answers for a migrated
 * tool, it answers plainly for one with no layout, it never calls the backend,
 * and it obeys the commerce gate that the ChatGPT surface depends on.
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
import { renderGuide } from "../../../src/tools/render-guide.js";
import {
  RENDER_BLOCKS,
  NO_COMMERCE_RENDER_BLOCKS,
} from "../../../src/render-blocks.generated.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_render_guide", () => {
  it("happy path — returns the block for a migrated tool, with no HTTP call", async () => {
    mockHttp([]);
    const res = await renderGuide.execute(newClient(), { tool: "leadbay_pull_leads" });
    expect(res.tool).toBe("leadbay_pull_leads");
    expect(res.guide).toBe(RENDER_BLOCKS.leadbay_pull_leads);
    expect(res.available).toContain("leadbay_pull_leads");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("accepts the bare stem, because a result names the tool either way", async () => {
    mockHttp([]);
    const res = await renderGuide.execute(newClient(), { tool: "pull_leads" });
    expect(res.tool).toBe("leadbay_pull_leads");
    expect(res.guide).toBeTruthy();
  });

  it("no argument — lists what has a guide instead of erroring", async () => {
    mockHttp([]);
    const res = await renderGuide.execute(newClient(), {});
    expect(res.guide).toBeNull();
    expect(res.available.length).toBeGreaterThan(0);
    expect(res.hint).toContain("available");
  });

  it("unknown tool — says so and names the recovery, never throws", async () => {
    mockHttp([]);
    const res = await renderGuide.execute(newClient(), { tool: "leadbay_not_a_tool" });
    expect(res.guide).toBeNull();
    expect(res.hint).toContain("leadbay_render_guide");
    expect(res.available).toEqual([...res.available].sort());
  });

  it("commerce-free client gets the stripped block", async () => {
    mockHttp([]);
    const client = newClient();
    client.commerce = false;
    for (const [name, stripped] of Object.entries(NO_COMMERCE_RENDER_BLOCKS)) {
      const res = await renderGuide.execute(client, { tool: name });
      expect(res.guide).toBe(stripped);
      expect(res.guide!.length).toBeLessThan(RENDER_BLOCKS[name].length);
    }
  });

  it("is declared read-only and closed-world, so a host can auto-approve it", () => {
    expect(renderGuide.annotations?.readOnlyHint).toBe(true);
    expect(renderGuide.annotations?.openWorldHint).toBe(false);
    expect((renderGuide.inputSchema as Record<string, unknown>).additionalProperties).toBe(false);
  });
});
