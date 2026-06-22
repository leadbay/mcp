import { describe, it, expect, beforeEach, vi } from "vitest";
import { lb, configure, call, Field, Action } from "../src/runtime.js";

// jsdom env (vitest.config.ts). These exercise the view-model data lifecycle:
// populate-from-API, value, loading/error, validation, field dependencies, the
// submit action, and the native-binding sugar.

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  configure({}); // reset the bridge to "host" (which is absent in jsdom)
  delete (globalThis as { cowork?: unknown }).cowork;
});

// ─── bridge / call normalization ─────────────────────────────────────────────

describe("call() envelope normalization", () => {
  it("prefers structuredContent", async () => {
    configure({ call: async () => ({ structuredContent: { a: 1 }, content: [{ text: "ignored" }] }) });
    expect(await call("t", {})).toEqual({ a: 1 });
  });
  it("parses content[0].text as JSON fallback", async () => {
    configure({ call: async () => ({ content: [{ text: '{"b":2}' }] }) });
    expect(await call("t", {})).toEqual({ b: 2 });
  });
  it("throws on isError", async () => {
    configure({ call: async () => ({ isError: true, content: [{ text: "boom" }] }) });
    await expect(call("t", {})).rejects.toThrow("boom");
  });
  it("throws code=unavailable when no bridge", async () => {
    await expect(call("t", {})).rejects.toMatchObject({ code: "unavailable" });
  });

  it("times out a never-settling bridge call (no infinite hang)", async () => {
    configure({ call: () => new Promise(() => {}), timeoutMs: 20 }); // never settles
    await expect(call("leadbay_team_activity", {})).rejects.toMatchObject({ code: "timeout" });
  });

  it("a hung call leaves a resource in error, not loading-forever", async () => {
    configure({ call: () => new Promise(() => {}), timeoutMs: 20 });
    const r = lb.resource({ load: () => call("leadbay_team_activity", {}) });
    await new Promise((res) => setTimeout(res, 60));
    expect(r.loading).toBe(false);
    expect(r.done).toBe(false);
    expect(r.error?.code).toBe("timeout");
  });
});

// ─── Field — value + API-populated options + state ───────────────────────────

describe("lb.field", () => {
  it("populates options from load(): loading idle→true→false, ready", async () => {
    const f = lb.field({
      load: () => Promise.resolve({ items: [{ id: "x", name: "Acme" }] }),
      options: (r: any) => r.items.map((i: any) => ({ value: i.id, label: i.name })),
    });
    expect(f.loading).toBe(true); // autoload started in constructor
    await tick();
    expect(f.loading).toBe(false);
    expect(f.ready).toBe(true);
    expect(f.options).toEqual([{ value: "x", label: "Acme" }]);
  });

  it("coerces a bare array when no options mapper is given", async () => {
    const f = lb.field({ load: () => Promise.resolve(["a", "b"]) });
    await tick();
    expect(f.options).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);
  });

  it("load failure sets .error (object) and empties options", async () => {
    const f = lb.field({ load: () => Promise.reject(new Error("nope")) });
    await tick();
    expect(f.error?.message).toBe("nope");
    expect(f.error?.unavailable).toBe(false);
    expect(f.options).toEqual([]);
    expect(f.loading).toBe(false);
  });

  it("missing bridge → .error.unavailable on load", async () => {
    const f = lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    await tick();
    expect(f.error?.unavailable).toBe(true);
    expect(f.loading).toBe(false);
  });

  it("setValue runs validation and exposes .valid", () => {
    const f = lb.field({ validate: (v) => (v ? null : "required") });
    expect(f.valid).toBe(false);
    f.setValue("hi");
    expect(f.value).toBe("hi");
    expect(f.error).toBeNull();
    expect(f.valid).toBe(true);
  });

  it("reloads when a dependsOn field's value changes", async () => {
    const parent = lb.field({ value: "p1" });
    const loads: string[] = [];
    const child = lb.field({
      dependsOn: [parent],
      load: () => {
        loads.push(String(parent.value));
        return Promise.resolve([]);
      },
    });
    await tick();
    expect(loads).toEqual(["p1"]); // initial autoload
    parent.setValue("p2");
    await tick();
    expect(loads).toEqual(["p1", "p2"]); // dependency-driven reload
  });

  it("notifies subscribers immediately and on change", () => {
    const f = lb.field({ value: "a" });
    const seen: unknown[] = [];
    f.subscribe((self) => seen.push(self.value));
    f.setValue("b");
    expect(seen).toEqual(["a", "b"]);
  });
});

// ─── Action — submit call + state ────────────────────────────────────────────

describe("lb.action", () => {
  it("run() calls the tool with computed args and tracks loading/lastResult", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    configure({ call: async (tool, args) => (calls.push({ tool, args }), { ok: true }) });
    const a = lb.action({ tool: "leadbay_like_lead", args: () => ({ lead_id: "L1" }) });
    const p = a.run();
    expect(a.loading).toBe(true);
    await p;
    expect(calls).toEqual([{ tool: "leadbay_like_lead", args: { lead_id: "L1" } }]);
    expect(a.loading).toBe(false);
    expect(a.lastResult).toEqual({ ok: true });
  });

  it("blocks the call when a required field is invalid", async () => {
    const calls: unknown[] = [];
    configure({ call: async () => (calls.push(1), {}) });
    const note = lb.field({ validate: (v) => (v ? null : "Add a note") });
    const a = lb.action({ tool: "leadbay_add_note", fields: [note], args: { leadId: "L1" } });
    await a.run();
    expect(calls).toHaveLength(0);
    expect(a.error?.message).toBe("Add a note");
    note.setValue("done");
    await a.run();
    expect(calls).toHaveLength(1);
  });

  it("confirm gate blocks until confirmed", async () => {
    const calls: unknown[] = [];
    configure({ call: async () => (calls.push(1), {}) });
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const a = lb.action({ tool: "leadbay_dislike_lead", args: { lead_id: "L1" }, confirm: "Sure?" });
    await a.run();
    expect(calls).toHaveLength(0);
    confirmSpy.mockReturnValue(true);
    await a.run();
    expect(calls).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it("blocks re-entry while loading", async () => {
    let resolve!: (v: unknown) => void;
    configure({ call: () => new Promise((r) => (resolve = r)) });
    const a = lb.action({ tool: "leadbay_like_lead", args: {} });
    const p1 = a.run();
    const p2 = a.run(); // ignored while loading
    expect(await p2).toBeUndefined();
    resolve({ ok: true });
    await p1;
    expect(a.lastResult).toEqual({ ok: true });
  });

  it("surfaces call errors + fires onError", async () => {
    configure({ call: async () => ({ isError: true, content: [{ text: "quota exceeded" }] }) });
    const seen: string[] = [];
    const a = lb.action({ tool: "leadbay_report_outreach", args: {}, onError: (e) => seen.push(e.message) });
    await a.run();
    expect(a.error?.message).toBe("quota exceeded");
    expect(seen).toEqual(["quota exceeded"]);
  });

  it("missing bridge → .error.unavailable, no throw", async () => {
    const a = lb.action({ tool: "leadbay_like_lead", args: {} });
    await a.run();
    expect(a.error?.unavailable).toBe(true);
    expect(a.error?.message).toMatch(/unavailable/i);
  });

  it("a throwing onSuccess is NOT mislabeled as a tool error (no success-then-error)", async () => {
    configure({ call: async () => ({ ok: true }) });
    let ran = false;
    const a = lb.action({
      tool: "leadbay_like_lead",
      args: {},
      onSuccess: () => {
        ran = true;
        throw new Error("boom in callback");
      },
    });
    await expect(a.run()).rejects.toThrow("boom in callback"); // propagates to caller
    expect(ran).toBe(true);
    expect(a.lastResult).toEqual({ ok: true });
    expect(a.error).toBeNull(); // stayed success — callback throw not caught as a tool error
  });
});

// ─── Binding sugar (jsdom) ───────────────────────────────────────────────────

describe("bind helpers", () => {
  it("bindSelect populates <option>s from the field and two-way binds value", async () => {
    const el = document.createElement("select");
    const f = lb.field({
      load: () => Promise.resolve([{ value: "c1", label: "Alpha" }, { value: "c2", label: "Beta" }]),
    });
    lb.bindSelect(el, f);
    await tick();
    expect([...el.options].map((o) => [o.value, o.textContent])).toEqual([
      ["c1", "Alpha"],
      ["c2", "Beta"],
    ]);
    expect(f.value).toBe("c1"); // defaulted to first option
    el.value = "c2";
    el.dispatchEvent(new Event("change"));
    expect(f.value).toBe("c2");
  });

  it("bindValue two-way binds an input + reflects data-lb-state", () => {
    const el = document.createElement("input");
    const f = lb.field({ validate: (v) => (v ? null : "req") });
    lb.bindValue(el, f);
    el.value = "typed";
    el.dispatchEvent(new Event("input"));
    expect(f.value).toBe("typed");
    expect(el.getAttribute("data-lb-state")).toBe("ready");
    f.setValue("set-externally");
    expect(el.value).toBe("set-externally");
    f.setValue("");
    expect(el.getAttribute("data-lb-state")).toBe("error");
  });

  it("bindAction wires click → run and reflects state", async () => {
    let resolve!: (v: unknown) => void;
    configure({ call: () => new Promise((r) => (resolve = r)) });
    const el = document.createElement("button");
    const a = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "L1" } });
    lb.bindAction(el, a);
    expect(el.getAttribute("data-lb-state")).toBe("idle");
    el.click();
    await tick();
    expect(el.getAttribute("data-lb-state")).toBe("loading");
    expect(el.disabled).toBe(true);
    resolve({ ok: true });
    await tick();
    expect(el.getAttribute("data-lb-state")).toBe("success");
    expect(el.disabled).toBe(false);
  });
});

// ─── class exports usable directly ───────────────────────────────────────────

describe("class exports", () => {
  it("Field and Action are constructable", () => {
    expect(new Field({ value: 1 }).value).toBe(1);
    expect(new Action({ tool: "t" }).loading).toBe(false);
  });
});
