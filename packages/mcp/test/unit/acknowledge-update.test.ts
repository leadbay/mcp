/**
 * leadbay_acknowledge_update — exercises each action's state mutation
 * + telemetry emission. Tests the tool directly (not through the MCP
 * envelope) so the failure mode of each branch is clear.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { UpdateStateStore } from "../../src/update-state.js";
import { buildAcknowledgeUpdateTool } from "../../src/update-tool.js";
import { NOOP_TELEMETRY, type TelemetryHandle } from "../../src/telemetry.js";
import type { LeadbayClient } from "@leadbay/core";

function makeTel() {
  const installed: any[] = [];
  const dismissed: any[] = [];
  const tel: TelemetryHandle & { installed: any[]; dismissed: any[] } = {
    ...NOOP_TELEMETRY,
    captureUpdateInstallClicked: (p) => installed.push(p),
    captureUpdateDismissed: (p) => dismissed.push(p),
    installed,
    dismissed,
  };
  return tel;
}

const FAKE_CLIENT = {} as LeadbayClient;

beforeEach(() => {
  // no global state
});

describe("leadbay_acknowledge_update — install", () => {
  it("emits install_clicked + returns the cached install_url and release_url", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 1,
      suppressed_versions: [],
      latest_known_version: "0.10.2",
      latest_known_install_url: "https://example.com/leadbay-0.10.2.dxt",
      latest_known_release_url: "https://example.com/releases/0.10.2",
    });
    const tel = makeTel();
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: tel,
      currentVersion: "0.10.1",
    });
    const out: any = await tool.execute(FAKE_CLIENT, { action: "install", version: "0.10.2" });
    expect(out.ok).toBe(true);
    expect(out.install_url).toBe("https://example.com/leadbay-0.10.2.dxt");
    expect(out.release_url).toBe("https://example.com/releases/0.10.2");
    expect(tel.installed).toEqual([
      { current_version: "0.10.1", latest_version: "0.10.2" },
    ]);
    // install must NOT mutate state — that's the next-boot's job.
    const s = await store.read();
    expect(s.remind_until).toBeUndefined();
    expect(s.suppressed_versions).toEqual([]);
  });

  it("returns null install_url when state has no cached asset", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      currentVersion: "0.10.1",
    });
    const out: any = await tool.execute(FAKE_CLIENT, { action: "install", version: "0.10.2" });
    expect(out.ok).toBe(true);
    expect(out.install_url).toBeNull();
  });
});

describe("leadbay_acknowledge_update — remind_tomorrow", () => {
  it("sets remind_until = now + 24h and emits dismissed{action:remind_tomorrow}", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTel();
    const now = 1_700_000_000_000;
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: tel,
      currentVersion: "0.10.1",
      now: () => now,
    });
    const out: any = await tool.execute(FAKE_CLIENT, {
      action: "remind_tomorrow",
      version: "0.10.2",
    });
    expect(out.ok).toBe(true);
    const s = await store.read();
    expect(s.remind_until).toBe(now + 24 * 60 * 60 * 1000);
    expect(tel.dismissed).toEqual([
      { current_version: "0.10.1", latest_version: "0.10.2", action: "remind_tomorrow" },
    ]);
  });
});

describe("leadbay_acknowledge_update — skip", () => {
  it("appends version to suppressed_versions + emits dismissed{action:skip}", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 1,
      suppressed_versions: ["0.10.0"],
    });
    const tel = makeTel();
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: tel,
      currentVersion: "0.10.1",
    });
    const out: any = await tool.execute(FAKE_CLIENT, { action: "skip", version: "0.10.2" });
    expect(out.ok).toBe(true);
    const s = await store.read();
    expect(s.suppressed_versions).toEqual(["0.10.0", "0.10.2"]);
    expect(tel.dismissed).toEqual([
      { current_version: "0.10.1", latest_version: "0.10.2", action: "skip" },
    ]);
  });

  it("dedupes when called twice for the same version", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      currentVersion: "0.10.1",
    });
    await tool.execute(FAKE_CLIENT, { action: "skip", version: "0.10.2" });
    await tool.execute(FAKE_CLIENT, { action: "skip", version: "0.10.2" });
    const s = await store.read();
    expect(s.suppressed_versions).toEqual(["0.10.2"]);
  });
});

describe("leadbay_acknowledge_update — bad input", () => {
  it("returns an INVALID_ARGUMENT envelope on unknown action", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      currentVersion: "0.10.1",
    });
    const out: any = await tool.execute(FAKE_CLIENT, { action: "banana", version: "0.10.2" });
    expect(out.error).toBe(true);
    expect(out.code).toBe("INVALID_ARGUMENT");
  });

  it("returns an INVALID_ARGUMENT envelope on missing version", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tool = buildAcknowledgeUpdateTool({
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      currentVersion: "0.10.1",
    });
    const out: any = await tool.execute(FAKE_CLIENT, { action: "skip" });
    expect(out.error).toBe(true);
    expect(out.code).toBe("INVALID_ARGUMENT");
  });
});
