import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  LeadbayClient,
  agentMemoryCapture,
  agentMemoryRecall,
  clearAgentMemoryCache,
} from "../../src/index.js";

const BASE = "https://api-us.leadbay.app";
let root: string;

beforeEach(async () => {
  resetHttpMock();
  clearAgentMemoryCache();
  root = await mkdtemp(join(tmpdir(), "leadbay-memory-roundtrip-"));
  process.env.LEADBAY_AGENT_MEMORY_ROOT = root;
});

afterEach(async () => {
  delete process.env.LEADBAY_AGENT_MEMORY_ROOT;
  clearAgentMemoryCache();
  await rm(root, { recursive: true, force: true });
});

describe("agent memory capture -> recall", () => {
  it("recalls a captured signal in the same session", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "user-1",
          email: "a@example.com",
          organization: { id: "org-1", name: "Org" },
        },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token", "us");

    const captured: any = await agentMemoryCapture.execute(client, {
      key: "preferred_sector",
      type: "preference",
      insight: "healthcare IT",
      confidence: 9,
      source: "user_stated",
    });
    expect(captured.post_capture_digest).toContain("healthcare IT");

    const recalled: any = await agentMemoryRecall.execute(client, {});
    expect(recalled.summary).toContain("healthcare IT");
    expect(recalled.top_keys).toContain("preferred_sector");
  });
});
