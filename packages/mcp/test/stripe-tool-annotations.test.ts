/**
 * The two Stripe tools must not advertise themselves as read-only.
 *
 * Both were annotated readOnlyHint:true. Each brings a Stripe session into
 * existence, and for an org with no Stripe customer yet the shared
 * getStripeCustomer path on the backend also creates the customer and persists
 * organizations.stripe_customer_id — so neither is read-only, GET or not.
 * Clients read this hint to decide whether to ask the user to confirm
 * (product#3998).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("Stripe tool annotations", () => {
  it("neither Stripe tool is annotated readOnly", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    for (const name of ["leadbay_create_topup_link", "leadbay_open_billing_portal"]) {
      const t = listed.tools.find((tool) => tool.name === name);
      expect(t, `${name} not found`).toBeDefined();
      expect(t!.annotations, `${name} annotations`).toBeDefined();
      expect(t!.annotations!.readOnlyHint, `${name} readOnlyHint`).toBe(false);
    }
  });
});
