import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { artifactKit } from "../../../src/tools/artifact-kit.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_artifact_kit", () => {
  it("returns the runtime + usage guide + version, with no HTTP call", async () => {
    mockHttp([]);
    const res: any = await artifactKit.execute(newClient(), {});
    expect(typeof res.version).toBe("string");
    expect(typeof res.runtime).toBe("string");
    expect(typeof res.usage_guide).toBe("string");
    // Static content — never touches the API.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("runtime is the self-contained IIFE exposing the LeadbayArtifacts view-model API", async () => {
    mockHttp([]);
    const res: any = await artifactKit.execute(newClient(), {});
    expect(res.runtime).toContain("LeadbayArtifacts");
    // The view-model surface + the host bridge + the styling hook are bundled.
    expect(res.runtime).toContain("field");
    expect(res.runtime).toContain("action");
    expect(res.runtime).toContain("bindSelect");
    expect(res.runtime).toContain("callMcpTool");
    expect(res.runtime).toContain("data-lb-state");
  });

  it("usage guide documents the write-call footguns the agent must not miss", async () => {
    mockHttp([]);
    const res: any = await artifactKit.execute(newClient(), {});
    // report_outreach's two rejection traps and the advanced-only limitation.
    expect(res.usage_guide).toContain("verification");
    expect(res.usage_guide).toContain("_triggered_by");
    expect(res.usage_guide).toMatch(/epilogue_status/);
    expect(res.usage_guide).toMatch(/advanced-gated/);
  });

  it("is read-only and not write-gated (callable in any deployment)", () => {
    expect(artifactKit.annotations?.readOnlyHint).toBe(true);
    expect(artifactKit.write).toBe(false);
  });
});
