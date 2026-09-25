/**
 * leadbay_set_prospecting_action toggles one of today's prospecting actions,
 * the way the web app's Prospection cell does: POST /leads/epilogue to turn it
 * on, DELETE /leads/{id}/epilogue?type= to turn it off, and no note either way.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
  expectAllScriptsConsumed,
} from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setProspectingAction } from "../../../src/composite/set-prospecting-action.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");
const LEAD = "39542caf-01b5-4e9d-b971-73ff49613d47";

beforeEach(() => resetHttpMock());

describe("leadbay_set_prospecting_action", () => {
  it("selected: true posts the epilogue for that one lead", async () => {
    mockHttp([{ method: "POST", path: "/1.6/leads/epilogue", status: 204 }]);

    const r: any = await setProspectingAction.execute(newClient(), {
      lead_id: LEAD,
      action: "STILL_CHASING",
      selected: true,
    });

    expect(r).toEqual({ lead_id: LEAD, action: "STILL_CHASING", selected: true });
    const [req] = getHttpRequests();
    expect(JSON.parse(req.body!)).toEqual({ lead_ids: [LEAD], status: "EPILOGUE_STILL_CHASING" });
    expectAllScriptsConsumed();
  });

  it("selected: false deletes that type from today's list", async () => {
    mockHttp([
      {
        method: "DELETE",
        path: `/1.6/leads/${LEAD}/epilogue?type=EPILOGUE_STILL_CHASING`,
        status: 204,
      },
    ]);

    const r: any = await setProspectingAction.execute(newClient(), {
      lead_id: LEAD,
      action: "STILL_CHASING",
      selected: false,
    });

    expect(r).toEqual({ lead_id: LEAD, action: "STILL_CHASING", selected: false });
    expectAllScriptsConsumed();
  });

  it("writes no note in either direction", async () => {
    // The difference from report_outreach: a toggle leaves nothing on the
    // timeline, so turning an action on and off by mistake costs nothing.
    mockHttp([
      { method: "POST", path: "/1.6/leads/epilogue", status: 204 },
      { method: "DELETE", path: `/1.6/leads/${LEAD}/epilogue?type=EPILOGUE_NOT_INTERESTED_LOST`, status: 204 },
    ]);

    await setProspectingAction.execute(newClient(), { lead_id: LEAD, action: "NOT_INTERESTED_LOST", selected: true });
    await setProspectingAction.execute(newClient(), { lead_id: LEAD, action: "NOT_INTERESTED_LOST", selected: false });

    expect(getHttpRequests().some((q) => q.path.includes("/notes"))).toBe(false);
  });

  it("accepts the EPILOGUE_-prefixed form and echoes the short one", async () => {
    mockHttp([{ method: "POST", path: "/1.6/leads/epilogue", status: 204 }]);

    const r: any = await setProspectingAction.execute(newClient(), {
      lead_id: LEAD,
      action: "EPILOGUE_COULD_NOT_REACH_STILL_TRYING",
      selected: true,
    });

    expect(r.action).toBe("COULD_NOT_REACH_STILL_TRYING");
  });

  it("rejects an unknown action before any call", async () => {
    mockHttp([]);
    await expect(
      setProspectingAction.execute(newClient(), { lead_id: LEAD, action: "WON", selected: true }),
    ).rejects.toThrow(/Unknown prospecting action/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("rejects a missing selected flag rather than guessing a direction", async () => {
    mockHttp([]);
    await expect(
      setProspectingAction.execute(newClient(), { lead_id: LEAD, action: "STILL_CHASING" } as any),
    ).rejects.toThrow(/selected must be true or false/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("propagates a 404 for a lead the user cannot see", async () => {
    mockHttp([
      {
        method: "DELETE",
        path: `/1.6/leads/${LEAD}/epilogue?type=EPILOGUE_STILL_CHASING`,
        status: 404,
        body: { code: "NOT_FOUND", message: "lead" },
      },
    ]);
    await expect(
      setProspectingAction.execute(newClient(), { lead_id: LEAD, action: "STILL_CHASING", selected: false }),
    ).rejects.toThrow();
  });
});
