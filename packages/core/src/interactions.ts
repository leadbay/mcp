import type { LeadbayClient } from "./client.js";
import type { ToolLogger } from "./types.js";

// The two events the web app logs as a user works through Discover: LEAD_SEEN
// when a lead appears in the list, LEAD_CLICKED when its profile is opened.
export type LeadInteractionType = "LEAD_SEEN" | "LEAD_CLICKED";

/**
 * Report consumed leads to `POST /interactions` — the backend's only writer of
 * `user_leads.stale_days`, which three of the four passes in the daily
 * lead-replacement job need. A lead we never report stays in the user's
 * Discover list forever.
 *
 * The wire fields are snake_case (`lead_id`, `lens_id`, see api-specs
 * backend/1.6/schemas/interactions/LeadSeenInteraction.yml). camelCase is
 * answered `400 unknown key 'leadId'`.
 *
 * Fire-and-forget — a failure must never break the read that triggered it —
 * but always logged: a swallowed 400 hid the camelCase bug for 145 days.
 */
export function reportLeadInteractions(
  client: LeadbayClient,
  lensId: number | string,
  leadIds: readonly string[],
  types: readonly LeadInteractionType[],
  logger?: ToolLogger
): void {
  if (leadIds.length === 0 || types.length === 0) return;
  const events = leadIds.flatMap((leadId) =>
    types.map((type) => ({ type, lead_id: leadId, lens_id: String(lensId) }))
  );
  void client
    .request<void>("POST", "/interactions", events)
    .catch((err: any) => {
      logger?.warn?.(
        `interactions: ${types.join("+")} for ${leadIds.length} lead(s) not recorded: ${err?.message ?? err?.code ?? err}`
      );
    });
}
