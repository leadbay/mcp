import type { LeadbayClient } from "../client.js";
import type { UserMePayload } from "../types.js";

// Sentinel for the AI-credit balance of an internal/unlimited account. A STRING
// (not Infinity/Symbol): Infinity serializes to null over MCP structuredContent
// — collapsing straight back into the "quota=null → no credits" bug this fixes —
// and a Symbol can't cross the wire at all. "unlimited" serializes cleanly and
// is self-describing to the reading LLM. product#3851.
export const UNLIMITED = "unlimited" as const;

// Internal/test accounts (@leadbay.ai, and whitelisted domains) have
// organization.disable_billing = true server-side, which zeroes their plan and
// short-circuits every billing gate — they are effectively unlimited. But the
// backend does NOT serialize disable_billing into /users/me, so on the wire an
// internal account looks identical to a broke free account (plan: null, no
// quota rows, ai_credits null/0). The only client-visible signal is the email
// domain. This is the single source of truth for the detection — a future
// backend flag can be swapped in here without touching call sites. product#3851.
//
// Deliberately email-ONLY: gating on plan===null / ai_credits==0 would wrongly
// unlock genuine plan-less paying orgs (the product#3761 class). A real out-of-
// credits customer never has an @leadbay.ai address.
export function isUnlimitedAccount(me: UserMePayload): boolean {
  return me.email?.toLowerCase().trim().endsWith("@leadbay.ai") ?? false;
}

// Remaining AI-credit balance from /users/me → organization.billing.ai_credits
// (types.ts BillingStatePayload). Returns UNLIMITED for internal/unlimited
// accounts (see isUnlimitedAccount). Returns null when billing is absent (older
// backend, or org without billing wired) — callers must treat null as
// "unknown", never as zero.
//
// `force` bypasses the 60s /me cache. Pass force=true AFTER a paid op so the
// post-spend balance is fresh; leave false for a pre-op BEFORE read where the
// cached value is fine.
export async function readCreditsRemaining(
  client: LeadbayClient,
  force = false
): Promise<number | typeof UNLIMITED | null> {
  try {
    const me = await client.resolveMe(force);
    if (isUnlimitedAccount(me)) return UNLIMITED;
    return me.organization.billing?.ai_credits ?? null;
  } catch {
    // Advisory only — never let a billing read failure break the enrichment
    // flow. The caller surfaces null = "unknown".
    return null;
  }
}
