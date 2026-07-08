import type { LeadbayClient } from "../client.js";
import type { UserMePayload } from "../types.js";

// Sentinel for the AI-credit balance of an internal/unlimited account. A STRING
// (not Infinity/Symbol): Infinity serializes to null over MCP structuredContent
// — collapsing straight back into the "quota=null → no credits" bug this fixes —
// and a Symbol can't cross the wire at all. "unlimited" serializes cleanly and
// is self-describing to the reading LLM. product#3851.
export const UNLIMITED = "unlimited" as const;

// An account is treated as UNLIMITED only when it is an internal @leadbay.ai
// account AND its billing is disabled server-side (organization.disable_billing
// = true). Both halves matter:
//
//   • @leadbay.ai + billing DISABLED → genuinely unlimited: the backend
//     removes all plan quotas, so quota/credits come back empty and would
//     misread as "no credits". Stay silent on quota; enrichment proceeds.
//     (product#3851)
//   • @leadbay.ai + billing ENABLED → act like a REAL user: the org is metered
//     (freemium or paid), has provisioned quota windows and a real cap, so the
//     quota gauge and credit story apply exactly as for any customer.
//
// The backend does NOT serialize disable_billing directly, but it hard-codes
// `billing.seats = 100_000` for disable_billing orgs (OrgPayload.kt) while a
// normally-billed org reports its real (small) seat count. That seat sentinel
// is the client-visible signal for "billing off". A future explicit flag can be
// swapped in here without touching call sites.
//
// The email gate stays first: gating on quota/credits alone would wrongly
// unlock genuine plan-less paying orgs (the product#3761 class). A real
// customer never has an @leadbay.ai address.
const DISABLE_BILLING_SEAT_SENTINEL = 100_000;

export function isUnlimitedAccount(me: UserMePayload): boolean {
  const isInternal = me.email?.toLowerCase().trim().endsWith("@leadbay.ai") ?? false;
  if (!isInternal) return false;
  const billing = me.organization.billing;
  // Billing ABSENT (older backend, or an internal org never wired to billing)
  // → nothing meters it → unlimited.
  if (billing == null) return true;
  // Billing PRESENT but seats ABSENT → unknown/legacy shape (e.g. the pre-3865
  // internal fixtures that only carried {ai_credits:0}). Treat a missing seat
  // count as still-unlimited so we don't regress the product#3851 internal
  // path — only a POSITIVE, small seat count is proof of active metering.
  if (billing.seats == null) return true;
  // Billing PRESENT with an explicit seat count: disabled only when the backend
  // stamped the disable_billing seat sentinel (100_000). A real (small) seat
  // count means the org is metered — freemium or paid — so treat as a real user.
  return billing.seats >= DISABLE_BILLING_SEAT_SENTINEL;
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
