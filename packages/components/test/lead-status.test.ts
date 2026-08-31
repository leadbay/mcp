import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// The lead-status dropdown added in 0.4.0: lb.leadStatus (the picker field),
// lb.setStatus (the write), and the Action-level guard that stops a
// {error:true} envelope or a partial write from reading as success.

const tick = () => new Promise((r) => setTimeout(r, 0));

let calls: Array<{ tool: string; args: Record<string, unknown> }>;

function stub(reply: unknown | ((args: Record<string, unknown>) => unknown)) {
  calls = [];
  configure({
    call: async (tool, args) => {
      calls.push({ tool, args });
      return typeof reply === "function"
        ? (reply as (a: Record<string, unknown>) => unknown)(args)
        : reply;
    },
  });
}

beforeEach(() => {
  configure({});
  calls = [];
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("lb.leadStatus", () => {
  it("offers the four human-settable statuses, in dropdown order", async () => {
    const f = lb.leadStatus("WANTED");
    await tick();
    expect(f.options.map((o) => o.value)).toEqual(["WANTED", "WON", "LOST", "UNWANTED"]);
    expect(f.options.map((o) => o.label)).toEqual(["Wanted", "Won", "Lost", "Unwanted"]);
  });

  it("opens on the lead's current status", async () => {
    const f = lb.leadStatus("LOST");
    await tick();
    expect(f.value).toBe("LOST");
    expect(f.valid).toBe(true);
  });

  it("accepts a lowercase current value", async () => {
    const f = lb.leadStatus("won");
    await tick();
    expect(f.value).toBe("WON");
  });

  it("an untouched lead gets a placeholder option, not a false 'Wanted'", async () => {
    const f = lb.leadStatus(null);
    await tick();
    expect(f.options[0].value).toBe("");
    expect(f.value).toBe("");
    // The placeholder must block a save — otherwise clicking Apply on an
    // untouched lead would silently write WANTED.
    expect(f.valid).toBe(false);
  });

  it("a system status (DEFAULT/INBOUND) is treated as not set", async () => {
    const f = lb.leadStatus("DEFAULT");
    await tick();
    expect(f.value).toBe("");
    expect(f.options[0].value).toBe("");
  });

  it("picking a real status clears the validation error", async () => {
    const f = lb.leadStatus(null);
    await tick();
    f.setValue("WON");
    expect(f.valid).toBe(true);
    expect(f.error).toBeNull();
  });
});

describe("lb.setStatus", () => {
  it("calls leadbay_set_lead_status with lead_ids + status", async () => {
    stub({ applied: true, count: 1, status: "WON", failed: [] });
    const status = lb.leadStatus("WON");
    await tick();

    await lb.setStatus({ leadId: "lead-1", status, ask: "we won Acme" }).run();

    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("leadbay_set_lead_status");
    expect(calls[0].args).toEqual({
      lead_ids: ["lead-1"],
      status: "WON",
      _triggered_by: "we won Acme",
    });
  });

  it("sends status_date only when the date field holds a value", async () => {
    stub({ applied: true, count: 1, status: "LOST", failed: [] });
    const status = lb.leadStatus("LOST");
    const date = lb.field();
    await tick();

    const a = lb.setStatus({ leadId: "lead-1", status, date });
    await a.run();
    expect(calls[0].args.status_date).toBeUndefined();

    date.setValue("2026-03-14");
    await a.run();
    expect(calls[1].args.status_date).toBe("2026-03-14");
  });

  it("an unset status blocks the call — nothing is written", async () => {
    stub({ applied: true, count: 1, failed: [] });
    const status = lb.leadStatus(null);
    await tick();

    const a = lb.setStatus({ leadId: "lead-1", status });
    await a.run();

    expect(calls).toHaveLength(0);
    expect(a.error?.message).toBe("Pick a status");
  });

  it("leadIds as a thunk is read at run() time, so a live selection works", async () => {
    stub({ applied: true, count: 2, status: "WANTED", failed: [] });
    const status = lb.leadStatus("WANTED");
    await tick();

    let selected = ["a"];
    const a = lb.setStatus({ leadIds: () => selected, status });
    await a.run();
    expect(calls[0].args.lead_ids).toEqual(["a"]);

    selected = ["a", "b"];
    await a.run();
    expect(calls[1].args.lead_ids).toEqual(["a", "b"]);
  });

  it("a partial write surfaces as an error, not a green button", async () => {
    stub({
      applied: true,
      count: 1,
      status: "WON",
      failed: [{ lead_id: "b", message: "lead not found" }],
    });
    const status = lb.leadStatus("WON");
    await tick();

    const a = lb.setStatus({ leadIds: ["a", "b"], status });
    await a.run();

    expect(a.error).not.toBeNull();
    expect(a.error?.message).toContain("1 of 2 leads failed");
    expect(a.error?.message).toContain("lead not found");
    expect(a.lastResult).toBeNull();
  });

  it("a total failure says the status was not applied", async () => {
    stub({
      applied: false,
      count: 0,
      status: "WON",
      failed: [{ lead_id: "a", message: "boom" }],
    });
    const status = lb.leadStatus("WON");
    await tick();

    const a = lb.setStatus({ leadId: "a", status });
    await a.run();

    expect(a.error?.message).toBe("Status not applied: boom");
  });

  it("a clean write settles as success", async () => {
    stub({ applied: true, count: 1, status: "WON", failed: [] });
    const status = lb.leadStatus("WON");
    await tick();

    const a = lb.setStatus({ leadId: "a", status });
    await a.run();

    expect(a.error).toBeNull();
    expect((a.lastResult as { status: string }).status).toBe("WON");
  });
});

describe("Action envelope guard", () => {
  it("an error:true envelope becomes an error state, not a success", async () => {
    stub({ error: true, code: "BAD_INPUT", message: "Unknown lead status", hint: "Use WON" });
    const status = lb.leadStatus("WON");
    await tick();

    const a = lb.setStatus({ leadId: "a", status });
    await a.run();

    expect(a.error?.message).toBe("Unknown lead status — Use WON");
    expect(a.lastResult).toBeNull();
  });

  it("the guard covers hand-rolled actions too", async () => {
    stub({ error: true, code: "QUOTA_EXCEEDED", message: "out of credits" });

    const a = lb.action({ tool: "leadbay_add_note", args: { note: "x" } });
    await a.run();

    expect(a.error?.message).toBe("out of credits");
  });

  it("an ordinary result is untouched", async () => {
    stub({ ok: true, error: false });

    const a = lb.action({ tool: "leadbay_add_note", args: {} });
    await a.run();

    expect(a.error).toBeNull();
    expect(a.lastResult).toEqual({ ok: true, error: false });
  });
});

describe("bindSelect + bindAction wiring", () => {
  it("populates the select and writes the picked value on click", async () => {
    stub({ applied: true, count: 1, status: "LOST", failed: [] });
    document.body.innerHTML =
      '<select id="st"></select><button id="go"></button>';
    const sel = document.getElementById("st") as HTMLSelectElement;
    const btn = document.getElementById("go") as HTMLButtonElement;

    const status = lb.leadStatus("WANTED");
    lb.bindSelect(sel, status);
    lb.bindAction(btn, lb.setStatus({ leadId: "lead-1", status }));
    await tick();

    expect([...sel.options].map((o) => o.value)).toEqual([
      "WANTED",
      "WON",
      "LOST",
      "UNWANTED",
    ]);
    expect(sel.value).toBe("WANTED");

    sel.value = "LOST";
    sel.dispatchEvent(new Event("change"));
    btn.click();
    await tick();

    expect(calls[0].args.status).toBe("LOST");
    expect(btn.getAttribute("data-lb-state")).toBe("success");
  });

  it("a partial write leaves the button in the error state", async () => {
    stub({
      applied: true,
      count: 0,
      status: "WON",
      failed: [{ lead_id: "a", message: "nope" }],
    });
    document.body.innerHTML = '<button id="go"></button>';
    const btn = document.getElementById("go") as HTMLButtonElement;

    const status = lb.leadStatus("WON");
    lb.bindAction(btn, lb.setStatus({ leadId: "a", status }));
    await tick();

    btn.click();
    await tick();

    expect(btn.getAttribute("data-lb-state")).toBe("error");
    expect(btn.getAttribute("data-lb-error")).toContain("nope");
  });

  it("with no host bridge the control degrades instead of throwing", async () => {
    configure({});
    document.body.innerHTML = '<button id="go"></button>';
    const btn = document.getElementById("go") as HTMLButtonElement;

    const status = lb.leadStatus("WON");
    const a = lb.setStatus({ leadId: "a", status });
    lb.bindAction(btn, a);
    await tick();

    btn.click();
    await tick();

    expect(a.error?.unavailable).toBe(true);
    expect(btn.getAttribute("data-lb-state")).toBe("unavailable");
  });
});
