import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_open_billing_portal as OPEN_BILLING_PORTAL_DESCRIPTION } from "../tool-descriptions.generated.js";

interface StripeUrlResponse {
  url: string;
}

export const openBillingPortal: Tool<Record<string, never>> = {
  name: "leadbay_open_billing_portal",
  annotations: {
    // Not read-only, despite being a GET: the backend mints a Stripe portal
    // session, and for an org with no customer yet it also creates the Stripe
    // customer and persists organizations.stripe_customer_id. Same
    // getStripeCustomer path as leadbay_create_topup_link.
    title: "Generate Stripe customer-portal URL for subscription management",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: OPEN_BILLING_PORTAL_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Stripe customer-portal URL. Surface as a clickable link; the user manages subscription / payment methods / invoices in their browser.",
      },
    },
    required: ["url"],
  },
  execute: async (client: LeadbayClient) => {
    return await client.request<StripeUrlResponse>("GET", "/stripe/portal");
  },
};
