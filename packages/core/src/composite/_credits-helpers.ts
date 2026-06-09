import type { LeadbayClient } from "../client.js";

// Remaining AI-credit balance from /users/me → organization.billing.ai_credits
// (types.ts BillingStatePayload). Returns null when billing is absent (older
// backend, or org without billing wired) — callers must treat null as
// "unknown", never as zero.
//
// `force` bypasses the 60s /me cache. Pass force=true AFTER a paid op so the
// post-spend balance is fresh; leave false for a pre-op BEFORE read where the
// cached value is fine.
export async function readCreditsRemaining(
  client: LeadbayClient,
  force = false
): Promise<number | null> {
  try {
    const me = await client.resolveMe(force);
    return me.organization.billing?.ai_credits ?? null;
  } catch {
    // Advisory only — never let a billing read failure break the enrichment
    // flow. The caller surfaces null = "unknown".
    return null;
  }
}
