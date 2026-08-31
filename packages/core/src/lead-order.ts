// The backend's LeadOrder enum, `FIELD:ASC|DESC`, shared by the two list
// endpoints that accept an `order` query param:
//
//   GET /monitor                        → leadbay_pull_followups
//   GET /lenses/{lensId}/leads/wishlist → leadbay_pull_leads
//
// Both declare it as an ARRAY of LeadOrder in the OpenAPI spec, but a single
// repeated-free value works on both (verified live), so the MCP takes one string.
//
// VALIDATION IS LOAD-BEARING. Neither endpoint rejects an unknown order: they
// answer 200 with ZERO rows. Unvalidated, a typo is indistinguishable from an
// empty Monitor or an over-narrow lens, which is the single most confusing
// failure this surface can produce.
//
// This is the subset a rep meaningfully sorts by; the full enum also carries
// ID, NEW, SAVED_AT, TRENDING_SCORE and other internals. Keep in sync with
// frontend/packages/state/api/generated.ts (type LeadOrder).
export const LEAD_ORDERS = [
  "SCORE:DESC",
  "SCORE:ASC",
  "NAME:ASC",
  "NAME:DESC",
  "SIZE:DESC",
  "SIZE:ASC",
  "SECTOR:ASC",
  "SECTOR:DESC",
  "STATUS:ASC",
  "STATUS:DESC",
  "CONTACT_COUNT:DESC",
  "CONTACT_COUNT:ASC",
  "LAST_PROSPECTING_ACTION_AT:DESC",
  "LAST_PROSPECTING_ACTION_AT:ASC",
  "EPILOGUE_STATUS_SET_AT:DESC",
  "EPILOGUE_STATUS_SET_AT:ASC",
  "LIKED:DESC",
  "DISLIKED:DESC",
] as const;

const LEAD_ORDER_SET = new Set<string>(LEAD_ORDERS);

/** Canonicalize a caller-supplied order ("name:asc" → "NAME:ASC"). Returns
 *  `{ order }` when valid or absent, `{ error }` with a ready-made envelope
 *  when not. No synonym guessing — an unrecognised value fails loudly. */
export function resolveLeadOrder(
  raw: string | undefined,
  tool: string,
): { order?: string; error?: { error: true; code: string; message: string; hint: string } } {
  const order = raw?.trim().toUpperCase();
  if (!order) return {};
  if (!LEAD_ORDER_SET.has(order)) {
    return {
      error: {
        error: true,
        code: "BAD_INPUT",
        message: `Unknown order: ${JSON.stringify(raw)}`,
        hint: `Call ${tool} again with one of: ${LEAD_ORDERS.join(", ")}.`,
      },
    };
  }
  return { order };
}
