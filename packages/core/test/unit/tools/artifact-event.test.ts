import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  artifactEvent,
  ARTIFACT_EVENT_KINDS,
  ARTIFACT_EVENT_SURFACES,
} from "../../../src/tools/artifact-event.js";

// leadbay_artifact_event (product#4081) is the ingest endpoint for the
// @leadbay/components artifact runtime. It makes NO backend call: it validates
// the event and hands it to the MCP telemetry layer via ctx.reportArtifactEvent,
// which decides Sentry (exceptions) vs PostHog (outcomes).

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

function ctxWithSink() {
  const seen: Array<Record<string, unknown>> = [];
  return { seen, ctx: { reportArtifactEvent: (ev: any) => void seen.push(ev) } as any };
}

beforeEach(() => resetHttpMock());

describe("leadbay_artifact_event", () => {
  it("happy path — forwards the event and makes no API call", async () => {
    mockHttp([]);
    const { seen, ctx } = ctxWithSink();
    const result: any = await artifactEvent.execute(
      newClient(),
      { kind: "call_timeout", surface: "action", tool: "leadbay_add_note", code: "timeout", kit_version: "0.6.0" },
      ctx,
    );
    expect(result).toEqual({ recorded: true, kind: "call_timeout" });
    expect(seen).toEqual([
      {
        kind: "call_timeout",
        surface: "action",
        kit_version: "0.6.0",
        tool: "leadbay_add_note",
        code: "timeout",
      },
    ]);
    // The whole point: this tool never touches the backend.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("accepts every declared kind and surface", async () => {
    mockHttp([]);
    for (const kind of ARTIFACT_EVENT_KINDS) {
      for (const surface of ARTIFACT_EVENT_SURFACES) {
        const { seen, ctx } = ctxWithSink();
        const r: any = await artifactEvent.execute(newClient(), { kind, surface }, ctx);
        expect(r.recorded).toBe(true);
        expect(seen).toHaveLength(1);
      }
    }
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("rejects an unknown kind rather than emitting an unbounded property", async () => {
    mockHttp([]);
    const { seen, ctx } = ctxWithSink();
    const r: any = await artifactEvent.execute(
      newClient(),
      { kind: "something_new", surface: "action" },
      ctx,
    );
    expect(r.error).toBe(true);
    expect(r.code).toBe("BAD_INPUT");
    expect(seen).toHaveLength(0);
  });

  it("rejects an unknown surface", async () => {
    mockHttp([]);
    const { seen, ctx } = ctxWithSink();
    const r: any = await artifactEvent.execute(
      newClient(),
      { kind: "call_failed", surface: "whatever" },
      ctx,
    );
    expect(r.error).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("rejects a missing kind/surface", async () => {
    mockHttp([]);
    const { ctx } = ctxWithSink();
    const r: any = await artifactEvent.execute(newClient(), {}, ctx);
    expect(r.error).toBe(true);
    expect(r.code).toBe("BAD_INPUT");
  });

  it("its hint points at the right tool instead of inviting a retry", async () => {
    mockHttp([]);
    const { ctx } = ctxWithSink();
    const r: any = await artifactEvent.execute(newClient(), { kind: "nope", surface: "nope" }, ctx);
    // An agent reading this must learn not to call it, and where user-raised
    // problems actually go.
    expect(r.hint).toContain("leadbay_report_friction");
    expect(r.hint).toContain("leadbay_artifact_kit");
  });

  it("bounds tool/code so a leaked message can't become an unbounded property", async () => {
    mockHttp([]);
    const { seen, ctx } = ctxWithSink();
    const long = "x".repeat(500);
    await artifactEvent.execute(
      newClient(),
      { kind: "call_failed", surface: "call", tool: long, code: long },
      ctx,
    );
    expect((seen[0].tool as string).length).toBeLessThanOrEqual(120);
    expect((seen[0].code as string).length).toBeLessThanOrEqual(120);
  });

  it("drops blank optional fields rather than emitting empty strings", async () => {
    mockHttp([]);
    const { seen, ctx } = ctxWithSink();
    await artifactEvent.execute(
      newClient(),
      { kind: "options_empty", surface: "field", tool: "   ", code: "" },
      ctx,
    );
    expect(seen[0]).toEqual({ kind: "options_empty", surface: "field" });
  });

  it("no sink (bare ToolContext) — still succeeds, never throws", async () => {
    mockHttp([]);
    const r: any = await artifactEvent.execute(newClient(), { kind: "call_failed", surface: "call" }, {} as any);
    expect(r.recorded).toBe(true);
  });

  it("no ctx at all — still succeeds", async () => {
    mockHttp([]);
    const r: any = await artifactEvent.execute(newClient(), { kind: "call_failed", surface: "call" });
    expect(r.recorded).toBe(true);
  });

  it("is read-only and carries no _triggered_by mandate", () => {
    // An artifact button click has no fresh user utterance to quote, so this
    // tool must stay OUT of the composite mandate.
    expect(artifactEvent.write).toBe(false);
    expect(artifactEvent.annotations?.readOnlyHint).toBe(true);
  });
});
