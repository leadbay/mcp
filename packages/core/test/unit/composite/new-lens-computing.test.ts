/**
 * Unit test for the #3833 fix on the new_lens side: a `created` lens that had
 * criteria applied kicks off an async backend wishlist rebuild, so the result
 * must signal that (computing_wishlist:true + a "leads stream in ~30s" message)
 * — the agent should NOT immediately pull and report an empty lens.
 *
 * A criteria-less clone inherits the base lens's leads immediately, so it must
 * NOT claim to be computing (computing_wishlist:false, plain message).
 *
 * NEW FILE — self-contained fixtures; does not touch new-lens.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { newLens } from "../../../src/composite/new-lens.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  language: "en",
  last_requested_lens: 42,
};
const SECTORS = [
  { id: "1", name: "Fintech" },
  { id: "2", name: "Plomberie" },
];

beforeEach(() => resetHttpMock());

describe("leadbay_new_lens — warm-up signal on created (#3833)", () => {
  it("created WITH criteria → computing_wishlist:true + ~30s / asynchronous message", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: "/1.6/sectors/all?lang=en&includeInvisible=false",
        status: 200,
        body: SECTORS,
      },
      {
        method: "POST",
        path: "/1.6/lenses",
        status: 200,
        body: { id: 900, name: "Fintech book", user_id: "u-1" },
      },
      { method: "POST", path: "/1.6/lenses/900/filter", status: 200, body: {} },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Fintech book",
      sectors: ["Fintech"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("created");
    expect(result.computing_wishlist).toBe(true);
    expect(result.message).toMatch(/~30s/);
    expect(result.message).toMatch(/asynchronous/i);
  });

  it("created with NO criteria → computing_wishlist:false + plain message (clone inherits base leads)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/lenses",
        status: 200,
        body: { id: 901, name: "Bare clone", user_id: "u-1" },
      },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Bare clone",
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("created");
    expect(result.computing_wishlist).toBe(false);
    expect(result.message).not.toMatch(/~30s/);
  });
});
