/**
 * A page that times out MID-DRAIN must not throw away the pages before it.
 *
 * `collectJobSnapshot` checks its remaining budget BEFORE starting each page
 * and breaks when it is spent — "stop with what we have; the cursor makes it
 * resumable". But a page that STARTS inside the budget can still consume it,
 * and that rejection used to escape the whole function: every item and cursor
 * already collected was discarded and the caller had to restart the drain from
 * page one. On a paid job those are rows the org was billed for.
 *
 * Uses a local node:https mock rather than the shared harness because the
 * behaviour under test is a stall, and the harness answers instantly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const seen: string[] = [];
// Paths listed here never answer — the request hangs until its deadline fires.
const stalling = new Set<string>();
// Paths listed here fail at the socket — a real error, not a deadline.
const failing = new Set<string>();

vi.mock("node:https", () => ({
  default: {
    request: (options: Record<string, unknown>, cb?: (res: unknown) => void) => {
      const path = String(options.path ?? "");
      seen.push(path);
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        if ([...stalling].some((p) => path.includes(p))) return;
        if ([...failing].some((p) => path.includes(p))) {
          setImmediate(() => req.emit("error", new Error("ECONNRESET")));
          return;
        }
        setImmediate(() => {
          const full = path.includes("cur-1");
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = 200;
          res.headers = {};
          cb?.(res);
          res.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                job: { id: "job-1", state: "completed" },
                funnel: { delivered: 4, examined: 4 },
                items: full
                  ? [{ status: "delivered", seq: 3 }, { status: "delivered", seq: 4 }]
                  : [{ status: "delivered", seq: 1 }, { status: "delivered", seq: 2 }],
                next_since: full ? "cur-2" : "cur-1",
                cost: { spent: 188, unit: "cost_cents", breakdown: {} },
                explain: { region: "us", model: "m" },
              })
            )
          );
          res.emit("end");
        });
      };
      return req;
    },
  },
}));

import { LeadbayClient } from "../../../src/client.js";
import { collectJobSnapshot } from "../../../src/composite/_mcp-job-helpers.js";

const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");

beforeEach(() => {
  seen.length = 0;
  stalling.clear();
  failing.clear();
});

describe("collectJobSnapshot — a mid-drain timeout keeps the pages already read", () => {
  it("returns the collected prefix with a resumable cursor instead of throwing", async () => {
    // Page 1 and 2 answer; page 3 (cur-2) never does.
    stalling.add("cur-2");

    const snap = await collectJobSnapshot(
      newClient(),
      "job-1",
      undefined,
      2, // pageLimit 2 — every answered page is FULL, so the drain keeps going
      undefined,
      300 // budget: enough for the two live pages, spent by the stalled third
    );

    // The rows the org paid for survive.
    expect(snap.items.map((i: any) => i.seq)).toEqual([1, 2, 3, 4]);
    // …and the caller is told the drain stopped early, with the handle to resume.
    expect(snap.items_truncated).toBe(true);
    expect(snap.next_since).toBe("cur-2");
    // Freshest projection is still reported.
    expect(snap.cost.spent).toBe(188);
    // It really did attempt the stalled page — otherwise this test would pass
    // for the wrong reason (a drain that simply stopped at the budget check).
    expect(seen.some((p) => p.includes("cur-2"))).toBe(true);
  });

  it("still propagates a non-timeout failure — only expiry is a soft stop", async () => {
    // The guard must be narrow. A transport error mid-drain is a real failure
    // and has to surface; swallowing it would report a partial job as if the
    // drain had merely run out of time.
    failing.add("cur-1");
    await expect(
      collectJobSnapshot(newClient(), "job-1", undefined, 2, undefined, 5_000)
    ).rejects.toBeDefined();
  });
});
