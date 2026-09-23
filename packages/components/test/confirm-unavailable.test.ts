import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// `window.confirm` is not available everywhere the kit runs. In a sandboxed
// artifact iframe it is commonly blocked: the call returns false WITHOUT
// showing a dialog.
//
// Action.run() treated that exactly like a decline — return early, no error,
// no state change. The observed result was a button that did nothing at all:
// no dialog, no message, no failure. The user reported it three times and
// each earlier diagnosis (a rejected arg, a wrong gate) was wrong because
// nothing about the symptom pointed at the confirm.
//
// A decline and an unavailable dialog are different outcomes and must read
// differently: declining is silent, because the rep knows what they chose;
// an unavailable dialog is an error the page can render.

const ORIG = Object.getOwnPropertyDescriptor(globalThis, "confirm");

let calls: string[];
function stub() {
  calls = [];
  configure({
    call: async (tool) => {
      calls.push(tool);
      return { triggered: true };
    },
  });
}

beforeEach(() => {
  configure({});
  delete (globalThis as any).cowork;
});

afterEach(() => {
  if (ORIG) Object.defineProperty(globalThis, "confirm", ORIG);
  else delete (globalThis as any).confirm;
});

describe("a confirm the page cannot show is an error, not silence", () => {
  it("surfaces an error when window.confirm does not exist", async () => {
    stub();
    delete (globalThis as any).confirm;
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1" });
    await act.run();
    expect(calls).toHaveLength(0);
    expect(act.error?.message).toMatch(/cannot show/i);
  });

  it("stays silent on a genuine decline — the rep knows they said no", async () => {
    stub();
    (globalThis as any).confirm = () => false;
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1" });
    await act.run();
    expect(calls).toHaveLength(0);
    expect(act.error).toBeNull();
  });

  it("proceeds when the dialog exists and is accepted", async () => {
    stub();
    (globalThis as any).confirm = () => true;
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1" });
    await act.run();
    expect(calls).toEqual(["leadbay_enrich_contacts"]);
    expect(act.error).toBeNull();
  });

  it('an action with confirm:"" never touches the dialog at all', async () => {
    // This is how a page supplies its OWN in-page confirmation, which is the
    // only reliable option inside the iframe.
    stub();
    delete (globalThis as any).confirm;
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1", confirm: "" });
    await act.run();
    expect(calls).toEqual(["leadbay_enrich_contacts"]);
    expect(act.error).toBeNull();
  });
});
