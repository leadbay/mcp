import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_create_topup_link as CREATE_TOPUP_LINK_DESCRIPTION } from "../tool-descriptions.generated.js";

interface StripeUrlResponse {
  url: string;
}

export const createTopupLink: Tool<Record<string, never>> = {
  name: "leadbay_create_topup_link",
  annotations: {
    // Not read-only: this POSTs a new Stripe Checkout Session into existence.
    // Clients read readOnlyHint to decide whether to ask the user to confirm.
    title: "Generate Stripe checkout URL for AI-credits top-up",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: CREATE_TOPUP_LINK_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Stripe-hosted checkout URL. Surface as a clickable link; the user completes payment in their browser. Top-up clears the throttle immediately after Stripe webhook lands.",
      },
    },
    required: ["url"],
  },
  execute: async (client: LeadbayClient) => {
    // POST with an empty body — backend infers user + org from the bearer token.
    return await client.request<StripeUrlResponse>("POST", "/stripe/topup_checkout", {});
  },
};
