import type { LeadbayClient } from "../client.js";
import {
  launchFingerprint,
  beginLaunch,
  abandonLaunch,
  rememberLaunch,
} from "../jobs/launch-guard.js";
import type {
  Tool,
  ToolContext,
  BulkEnrichPreview,
  WishlistResponse,
} from "../types.js";

import { readCreditsRemaining } from "./_credits-helpers.js";
import { leadbay_enrich_titles as ENRICH_TITLES_DESCRIPTION } from "../tool-descriptions.generated.js";
interface EnrichTitlesParams {
  titles?: string[];
  leadIds?: string[];
  lensId?: number;
  email?: boolean;
  phone?: boolean;
  candidateCount?: number;
  dry_run?: boolean;
  confirm?: boolean;
}

const DEFAULT_CANDIDATE_COUNT = 25;

interface LaunchArgs {
  leadIds: string[];
  titles: string[];
  email: boolean;
  phone: boolean;
  lensId: number;
  selectionSource: "explicit" | "wishlist";
  preview: BulkEnrichPreview;
}

// The paid launch, on a selection that is ALREADY set and under a lock the
// caller already holds. No lock/select/clear here — the caller owns that
// lifecycle. Two callers:
//   1. the non-eliciting path launches inline inside the preview lock (no extra
//      round-trips — preserves the historical single-lock select→…→launch→clear
//      sequence), and
//   2. launchEnrichment() below, for the elicit-accept path.
async function launchOnSelection(
  client: LeadbayClient,
  args: LaunchArgs,
  ctx?: ToolContext
) {
  const { leadIds, titles, email, phone, lensId, selectionSource, preview } =
    args;

  // Double-launch guard. The only thing the backend cannot tell us is whether
  // we fired this exact request seconds ago, so we remember the fingerprint
  // in-process for five minutes. Everything else about the job — identity,
  // progress, retention — belongs to the backend.
  const fingerprint = launchFingerprint([
    "enrich",
    leadIds,
    titles,
    email,
    phone,
    lensId,
  ]);
  const claim = beginLaunch(fingerprint);
  if (claim.state === "in_flight") {
    return {
      mode: "launch_in_flight",
      launched: false,
      preview,
      lead_ids: leadIds,
      titles,
      message:
        `An identical enrichment was started ${claim.seconds_since}s ago and has not returned its job id yet. ` +
        "Nothing was launched twice and no quota was spent.",
      next_action:
        "Wait a few seconds and call leadbay_enrich_titles again with the same arguments — it will hand back the job id once the first call settles. Do not treat this as a running job; there is no id to poll yet.",
    };
  }
  const already = claim.state === "settled" ? claim.record : undefined;
  if (already) {
    return {
      mode: "already_launched",
      launched: true,
      preview,
      reused: true,
      seconds_since_original_launch: already.seconds_since,
      lead_ids: leadIds,
      titles,
      email,
      phone,
      notification_id: already.notification_id,
      launched_at: already.launched_at,
      message:
        `An identical enrichment was launched ${already.seconds_since}s ago; this call did NOT spend quota again. ` +
        "Poll the original job rather than relaunching.",
      next_action:
        "Poll leadbay_bulk_enrich_status({notification_id, lead_ids, include_contacts: true}) until all_done, or until overall_progress.done holds steady across spaced polls (~15-30s apart) — unresolvable contacts never flip. Then report what landed and name what didn't.",
    };
  }

  // Phase 3/3: launch the enrichment job on the backend.
  ctx?.progress?.({
    progress: 3,
    total: 3,
    message: `Launching enrichment for ${titles.length} title${titles.length === 1 ? "" : "s"}…`,
  });
  let launchResp: { notification_id: string | null } | null = null;
  try {
    launchResp = await client.request<{ notification_id: string | null }>(
      "POST",
      "/leads/selection/enrichment/launch",
      { titles, email, phone }
    );
  } catch (err: any) {
    // The claim must not outlive a launch that did not happen, or an identical
    // retry inside the window is told it already ran (product#4039).
    abandonLaunch(fingerprint);
    if (err?.code === "QUOTA_EXCEEDED") {
      return {
        status: "quota_exceeded",
        preview,
        message: "Quota exceeded on launch",
        retry_after_seconds: err?._meta?.retry_after ?? null,
      };
    }
    throw err;
  }

  const notificationId = launchResp?.notification_id ?? null;
  const remembered = rememberLaunch(fingerprint, notificationId);

  return {
    mode: "launched",
    preview,
    launched: true,
    titles,
    email,
    phone,
    // Always surfaced: these are the coordinates the agent polls with. There is
    // no server-side handle to look them up from, by design.
    lead_ids: leadIds,
    notification_id: notificationId,
    launched_at: remembered.launched_at,
    message: notificationId
      ? "Enrichment job launched (runs async). Unless the user asked NOT to wait, do NOT end your turn here — poll " +
        "leadbay_bulk_enrich_status({notification_id, lead_ids}) until all_done OR until progress plateaus " +
        "(overall_progress.done stops climbing across spaced polls — unresolvable contacts keep all_done:false forever), " +
        "then report the finished contacts yourself. The notification_id keeps working across conversations and days; " +
        "completion also surfaces via _meta.notifications / leadbay_account_status.notifications."
      : "Enrichment job launched, but the backend returned no notification_id, so there is no job id to poll. " +
        "Poll leadbay_bulk_enrich_status({lead_ids, titles, email, phone}) instead — it answers per lead without a job id.",
    next_action: notificationId
      ? "Unless the user explicitly asked NOT to wait, poll leadbay_bulk_enrich_status({notification_id, lead_ids, include_contacts: true}) until all_done — OR until overall_progress.done holds steady across several SPACED polls (~15-30s apart, ~90s-2min elapsed; don't call a plateau from the first back-to-back reads, and not while partial_failures is present — that's transient, respect retry_after). Then report the resolved enrichment in THIS turn, naming what landed and what didn't. If the user DID ask not to wait, hand back the notification_id — it resolves later from any conversation."
      : "Poll leadbay_bulk_enrich_status({lead_ids, titles, email, phone, include_contacts: true}) every ~30s. It scopes counting to these titles and treats a contact as done only when the REQUESTED channel landed, so you do not have to do that yourself. Stop once overall_progress.done stops growing across a couple of spaced re-checks (~90s-2min) — unresolvable contacts never flip.",
  };
}

// Launch under its OWN selection lock — used ONLY by the elicit-accept path,
// where the preview phase already released the lock (so the consent prompt is
// awaited with no lock held, product#3848 review). Re-selects the same leads
// because the preview phase cleared the selection, then delegates to
// launchOnSelection and always clears + releases.
async function launchEnrichment(
  client: LeadbayClient,
  args: LaunchArgs,
  ctx?: ToolContext
) {
  await client.acquireSelectionLock();
  try {
    const qs = args.leadIds
      .map((id) => `leadIds=${encodeURIComponent(id)}`)
      .join("&");
    await client.requestVoid("POST", `/leads/selection/select?${qs}`);
    try {
      return await launchOnSelection(client, args, ctx);
    } finally {
      try {
        await client.requestVoid("POST", "/leads/selection/clear");
      } catch (e: any) {
        ctx?.logger?.warn?.(
          `enrich_titles: selection.clear failed: ${e?.message ?? e?.code}`
        );
      }
    }
  } finally {
    client.releaseSelectionLock();
  }
}

export const enrichTitles: Tool<EnrichTitlesParams> = {
  name: "leadbay_enrich_titles",
  annotations: {
    title: "Enrich contact titles across leads",
    readOnlyHint: false,
    // Mode A (no titles): non-destructive preview returning candidates.
    // Mode B (with titles): launches enrichment job. Net classification is
    // destructive because the dominant flow mutates state.
    destructiveHint: true,
    // Idempotent against the same selection + titles set (same hash → same
    // the launch; backend silently no-ops on already-enriched contacts).
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ENRICH_TITLES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      notification_id: {
        type: ["string", "null"],
        description:
          "The backend's job id. Carry it to leadbay_bulk_enrich_status. Null when the backend returned none — then poll by lead_ids instead.",
      },
      lead_ids: {
        type: "array",
        description:
          "The leads this run enriched. Carry them to leadbay_bulk_enrich_status for per-lead progress; they also work when the notification is archived.",
        items: { type: "string" },
      },
      reused: {
        type: "boolean",
        description: "True when an identical launch inside the 5-minute window was reused instead of spending quota again.",
      },
      titles: {
        type: "array",
        items: { type: "string" },
        description:
          "Job titles to enrich. Omit to discover what's available without launching.",
      },
      leadIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Lead UUIDs to enrich. Omit to use the top page of the active lens's wishlist.",
      },
      lensId: {
        type: "number",
        description: "Lens id (escape hatch — defaults to active)",
      },
      email: { type: "boolean", description: "Enrich emails (default true)" },
      phone: { type: "boolean", description: "Enrich phone numbers (default false)" },
      candidateCount: {
        type: "number",
        description: `When leadIds is omitted, how many top-of-wishlist leads to use (default ${DEFAULT_CANDIDATE_COUNT})`,
      },
      dry_run: {
        type: "boolean",
        description: "If true, don't launch — only preview.",
      },
      confirm: {
        type: "boolean",
        description:
          "Explicit spend decision for the paid enrichment. true = go ahead and launch. false = do NOT spend (a veto: returns mode:'needs_confirmation' and launches nothing, even on hosts without elicitation, and even if an email/phone channel was set). Omitted (and no explicit email/phone channel) → an elicitation-capable host asks the user before launching; a decline returns mode:'needs_confirmation'. Passing email:true/phone:true also counts as consent.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Branchy return shape; the `mode` (or `status`) field tells the agent which branch it got. Modes: 'discover' (no titles passed), 'preview_only' (no enrichable contacts), 'dry_run', 'needs_confirmation' (paid launch withheld pending user consent), 'already_launched' (idempotent reuse), 'launch_in_flight' (an identical launch is mid-flight and has no id yet), 'launched' (happy path). Status: 'quota_exceeded' (429).",
    properties: {
      mode: {
        type: "string",
        description: "'discover' | 'preview_only' | 'dry_run' | 'needs_confirmation' | 'already_launched' | 'launch_in_flight' | 'launched'.",
      },
      status: {
        type: "string",
        description: "'quota_exceeded' on 429. Otherwise mode is set instead.",
      },
      available_titles: {
        type: "array",
        description: "Titles available across the selection (discover/preview_only modes).",
        items: { type: "string" },
      },
      recommendations: {
        type: "array",
        description: "Backend's title_suggestions (discover mode).",
        items: { type: "string" },
      },
      auto_included: {
        type: "array",
        description: "Backend's auto_included_titles (discover mode).",
        items: { type: "string" },
      },
      previously_enriched: {
        type: "array",
        description: "Titles previously enriched on this selection (discover mode).",
        items: { type: "string" },
      },
      enrichable_contacts: {
        type: "number",
        description: "Count of enrichable contacts at preview time.",
      },
      credits_remaining: {
        type: ["number", "string", "null"],
        description:
          "Advisory-only balance (billing.ai_credits), present in discover / preview_only / dry_run modes. Enrichment is gated by QUOTA (email + phone reveals consume the per-window allowance in leadbay_account_status), NOT by this number — do NOT present it as a spend gate, do NOT say 'you have N credits', and NEVER refuse enrichment because it's low or zero. Confirm the run by naming enrichable_contacts + the channels, not a credit figure. Null = billing unavailable. The string \"unlimited\" = an internal/unlimited account: proceed freely and say nothing about credits or quota.",
      },
      selected_lead_count: {
        type: "number",
        description: "How many leads the selection covers.",
      },
      preview: {
        type: "object",
        description: "Backend BulkEnrichPreview payload (preview_only/dry_run/launched modes).",
      },
      launched: {
        type: "boolean",
        description: "True when an enrichment job is in flight on the backend.",
      },
      would_launch: {
        type: "object",
        description: "What dry_run WOULD have launched (titles, email, phone).",
      },
      launched_at: {
        type: "string",
        description: "ISO timestamp of the (re-used or fresh) launch.",
      },
      seconds_since_original_launch: {
        type: "number",
        description: "Age of the re-used bulk record (already_launched mode).",
      },
      titles: {
        type: "array",
        description: "Titles ordered (echoed at launch).",
        items: { type: "string" },
      },
      email: { type: "boolean" },
      phone: { type: "boolean" },
      message: {
        type: "string",
        description: "Operator-facing summary of what happened.",
      },
      next_action: {
        type: "string",
        description: "Concrete next-step instruction for the agent.",
      },
      retry_after_seconds: {
        type: ["number", "null"],
        description: "Seconds until quota resets (quota_exceeded status).",
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: EnrichTitlesParams,
    ctx?: ToolContext
  ) => {
    // Channel resolution (product#3848). Rules, in order:
    //  - email honours params.email if set.
    //  - phone defaults off.
    //  - email defaults ON only when the caller enabled NO paid channel — i.e.
    //    neither email:true nor phone:true. A phone-only reveal (phone:true,
    //    email unset) must NOT silently add email (Codex P1). But a mere
    //    DISABLED flag like phone:false does not count as "picking a channel":
    //    {confirm:true, phone:false} still means "launch the default email
    //    spend I approved", so email must stay on there (Codex P2 round-4) —
    //    keying off enabled channels, not merely present keys, gives that.
    const anyChannelEnabled =
      params.email === true || params.phone === true;
    const email = params.email ?? !anyChannelEnabled;
    const phone = params.phone ?? false;

    const hasTitles = !!params.titles && params.titles.length > 0;

    // The "one paid channel must be enabled" rule only applies to the
    // launch/dry-run path (titles given). Discovery (no titles) is a FREE read
    // — it must run regardless of channel flags, so a caller that merely spells
    // out the default `phone:false` while omitting titles still gets the title
    // menu/counts instead of BAD_INPUT (Codex P2). The consent gate below
    // further protects the paid launch.
    if (hasTitles && !email && !phone) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Either email or phone must be true",
        hint: "Set email:true (most common) or phone:true",
      };
    }

    const explicitLeadIds = params.leadIds && params.leadIds.length > 0;
    const selectionSource: "explicit" | "wishlist" = explicitLeadIds
      ? "explicit"
      : "wishlist";
    // Resolve lens_id once so bulkTracker gets it regardless of which branch
    // populates leadIds.
    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    let leadIds = params.leadIds;
    if (!leadIds || leadIds.length === 0) {
      const cnt = params.candidateCount ?? DEFAULT_CANDIDATE_COUNT;
      const wish = await client.request<WishlistResponse>(
        "GET",
        `/lenses/${lensId}/leads/wishlist?count=${Math.min(cnt, 50)}&page=0`
      );
      leadIds = wish.items.map((l) => l.id);
    }

    if (leadIds.length === 0) {
      return {
        error: true,
        code: "NO_CANDIDATES",
        message: "No candidate leads",
        hint: "Pass leadIds explicitly or wait for the wishlist to compute",
      };
    }

    // Consent gate (product#3848): a bare "enrich titles X" leaves email
    // defaulted ON — a PAID reveal the user may not have asked for (title &
    // LinkedIn already ride on the contact, free). Consent = an explicitly
    // ENABLED paid channel (email===true / phone===true) OR confirm:true — NOT
    // merely a channel key being present (`phone:false` with email unset must
    // NOT count, since email still defaults true). When NOT consented and the
    // host can ask the user (ctx.elicit), we must confirm before spending.
    //
    // willElicit is knowable up front (params + ctx only). It decides the lock
    // shape: when we WON'T elicit (consented, or no elicit capability), the
    // launch runs inline inside the single preview lock — preserving the
    // historical select→preview→launch→clear sequence with no extra round-trip.
    // Only when we WILL elicit do we split into two phases (preview lock →
    // release → elicit with NO lock held → re-select + launch under a fresh
    // lock), so a human deciding at the prompt never blocks other selection
    // work or pins the backend selection (product#3848 review).
    const channelEnabledExplicitly =
      params.email === true || params.phone === true;
    // An explicit confirm:false is a VETO — the caller is declining the spend
    // (e.g. a direct/core caller or an artifact passing confirm:false to avoid
    // launching). It must withhold regardless of channel or elicit capability;
    // it is NOT the same as confirm being absent (Codex P2). A veto wins even
    // over an explicit channel flag: the caller said "don't spend".
    const vetoed = params.confirm === false;
    const consented =
      !vetoed && (params.confirm === true || channelEnabledExplicitly);
    // Only elicit when we're neither consented nor vetoed — a veto returns
    // needs_confirmation directly, no prompt.
    const willElicit =
      !consented && !vetoed && typeof ctx?.elicit === "function";

    // Phase 1: PREVIEW under the selection lock. When willElicit, this phase
    // holds the lock ONLY for select → preview → clear; the launch happens later
    // under a fresh lock. When NOT willElicit, the launch runs inline here.
    ctx?.progress?.({
      progress: 1,
      total: 3,
      message: `Selecting ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}…`,
    });

    // The preview phase returns EITHER a terminal result (discover /
    // preview_only / dry_run / quota_exceeded — the caller returns it as-is) OR
    // the preview payload to carry into the consent + launch phases.
    type PreviewOutcome =
      | { kind: "terminal"; result: Record<string, unknown> }
      | { kind: "preview"; preview: BulkEnrichPreview; availableTitles: string[] };

    let outcome: PreviewOutcome;
    await client.acquireSelectionLock();
    try {
      const qs = leadIds
        .map((id) => `leadIds=${encodeURIComponent(id)}`)
        .join("&");
      await client.requestVoid("POST", `/leads/selection/select?${qs}`);

      try {
        // Phase 2/2 of preview: title discovery + counts.
        ctx?.progress?.({
          progress: 2,
          total: 3,
          message: "Previewing enrichment (titles + counts)…",
        });
        // Get titles available across this selection.
        const availableTitles = await client.request<string[]>(
          "GET",
          "/leads/selection/enrichment/job_titles"
        );

        if (!params.titles || params.titles.length === 0) {
          // Branch A — discovery. Run a 0-titles preview to surface
          // title_suggestions / auto_included_titles / previously_enriched_titles.
          let suggestions: string[] = [];
          let autoIncluded: string[] = [];
          let previouslyEnriched: string[] = [];
          let enrichableContacts = 0;
          try {
            const prev = await client.request<BulkEnrichPreview>(
              "POST",
              "/leads/selection/enrichment/preview",
              { titles: [] }
            );
            suggestions = prev.title_suggestions ?? [];
            autoIncluded = prev.auto_included_titles ?? [];
            previouslyEnriched = prev.previously_enriched_titles ?? [];
            enrichableContacts = prev.enrichable_contacts;
          } catch (e: any) {
            ctx?.logger?.warn?.(
              `enrich_titles: 0-titles preview failed: ${e?.message}`
            );
          }
          outcome = {
            kind: "terminal",
            result: {
              mode: "discover",
              available_titles: availableTitles,
              recommendations: suggestions,
              auto_included: autoIncluded,
              previously_enriched: previouslyEnriched,
              enrichable_contacts: enrichableContacts,
              selected_lead_count: leadIds.length,
              // BEFORE: show balance + volume. We can't estimate exact cost
              // (the per-contact rate is backend-only), so surface the balance
              // and the count, not a fabricated "will cost N".
              credits_remaining: await readCreditsRemaining(client),
              next_action:
                "Pick titles to enrich and call leadbay_enrich_titles again with titles=[...]",
            },
          };
        } else {
          // Branch B — preview (launch happens AFTER the lock is released).
          let preview: BulkEnrichPreview;
          try {
            preview = await client.request<BulkEnrichPreview>(
              "POST",
              "/leads/selection/enrichment/preview",
              { titles: params.titles }
            );
          } catch (err: any) {
            if (err?.code === "QUOTA_EXCEEDED") {
              // Early return from inside the lock's try — the clear finally +
              // release finally still run, so the selection is cleaned up.
              return {
                status: "quota_exceeded",
                message: "Quota exceeded on preview",
                retry_after_seconds: err?._meta?.retry_after ?? null,
              };
            }
            throw err;
          }

          if (preview.enrichable_contacts === 0) {
            outcome = {
              kind: "terminal",
              result: {
                mode: "preview_only",
                preview,
                launched: false,
                message:
                  "No enrichable contacts for the chosen titles. Try other titles from available_titles or recommendations.",
                available_titles: availableTitles,
                credits_remaining: await readCreditsRemaining(client),
              },
            };
          } else if (params.dry_run) {
            outcome = {
              kind: "terminal",
              result: {
                mode: "dry_run",
                preview,
                launched: false,
                would_launch: { titles: params.titles, email, phone },
                // BEFORE confirmation gate: balance + how many contacts WOULD be
                // enriched. enrichable_contacts is the volume; credits_remaining
                // the balance. No estimated cost — that rate is backend-only.
                enrichable_contacts: preview.enrichable_contacts,
                credits_remaining: await readCreditsRemaining(client),
              },
            };
          } else if (vetoed) {
            // Explicit confirm:false — the caller declined the spend. Withhold
            // and return needs_confirmation (never launch), regardless of elicit
            // capability (Codex P2).
            outcome = {
              kind: "terminal",
              result: {
                mode: "needs_confirmation",
                preview,
                launched: false,
                would_launch: { titles: params.titles, email, phone },
                enrichable_contacts: preview.enrichable_contacts,
                credits_remaining: await readCreditsRemaining(client),
                available_titles: availableTitles,
                message:
                  "Enrichment not launched — confirm:false was passed (spend declined). " +
                  "Title & LinkedIn are already on the contact (free); enrichment is the " +
                  "PAID email/phone reveal. Re-call with confirm:true (or email:true) to spend.",
                next_action:
                  "Re-call leadbay_enrich_titles with confirm:true once the user approves the spend.",
              },
            };
          } else if (!willElicit) {
            // Consented (or no elicit capability): launch INLINE under this same
            // lock, on the already-set selection — the historical single-lock
            // select→preview→launch→clear sequence, no extra round-trip.
            outcome = {
              kind: "terminal",
              result: await launchOnSelection(
                client,
                {
                  leadIds,
                  titles: params.titles,
                  email,
                  phone,
                  lensId,
                  selectionSource,
                  preview,
                },
                ctx
              ),
            };
          } else {
            // Will elicit: defer the launch until AFTER the lock is released so
            // the consent prompt is awaited with no lock held.
            outcome = { kind: "preview", preview, availableTitles };
          }
        }
      } finally {
        // Always clear, but never re-throw from finally (would mask the
        // original error if there was one). This runs BEFORE the lock releases
        // and before any consent elicitation, so the backend selection is not
        // left set while a human is deciding.
        try {
          await client.requestVoid("POST", "/leads/selection/clear");
        } catch (e: any) {
          ctx?.logger?.warn?.(
            `enrich_titles: selection.clear failed: ${e?.message ?? e?.code}`
          );
        }
      }
    } finally {
      client.releaseSelectionLock();
    }

    // Lock released. Terminal branches (discover / preview_only / dry_run)
    // return here with nothing held.
    if (outcome.kind === "terminal") {
      return outcome.result;
    }
    const { preview, availableTitles } = outcome;

    // We only reach here on the willElicit path (kind:"preview"): not consented
    // AND the host can ask the user. The elicitation runs with NO selection lock
    // held (the preview phase already released it), so a user leaving the prompt
    // open never blocks other selection-based composites (product#3848 review).
    const creditsRemaining = await readCreditsRemaining(client);
    // The caller reached elicitation with NO explicit channel — email is on by
    // default and phone is off. Rather than silently confirm an email-only run
    // (which hides the phone option the no-channel flow promises), OFFER the
    // phone choice IN the prompt: an include_phone toggle the user can flip.
    // When phone was already explicitly requested we skip the toggle (it's
    // already decided) and just confirm. `effectivePhone` folds the answer in.
    let effectivePhone = phone;
    let accepted = false;
    try {
      const answer = await ctx!.elicit!({
        message:
          `Enrich ${preview.enrichable_contacts} contact${preview.enrichable_contacts === 1 ? "" : "s"} — ` +
          `email is included${phone ? " + phone" : ""}. Email and phone reveals each consume quota.` +
          (phone ? "" : " Add phone numbers too?"),
        requestedSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              title: "Enrich now?",
              description:
                "Confirm to launch enrichment on these contacts (email reveal consumes quota).",
            },
            // Only offered when phone wasn't already chosen — lets the user opt
            // into the phone reveal (extra quota) instead of email-only.
            ...(phone
              ? {}
              : {
                  include_phone: {
                    type: "boolean",
                    title: "Also reveal phone numbers?",
                    description:
                      "Opt in to phone reveals as well (uses more quota than email alone). Leave off for email only.",
                  },
                }),
          },
          required: ["confirm"],
        },
      });
      // accept with confirm !== false → launch. A form host that returns
      // no content on accept is treated as consent (the user clicked OK).
      const content = answer.content as
        | { confirm?: unknown; include_phone?: unknown }
        | undefined;
      accepted = answer.action === "accept" && content?.confirm !== false;
      // Fold the user's phone choice in (only when phone wasn't pre-set).
      if (accepted && !phone && content?.include_phone === true) {
        effectivePhone = true;
      }
    } catch (e: any) {
      // Elicit transport failure → don't silently spend; withhold.
      ctx?.logger?.warn?.(
        `enrich_titles: elicit failed, withholding launch: ${e?.message ?? e}`
      );
      accepted = false;
    }
    if (!accepted) {
      return {
        mode: "needs_confirmation",
        preview,
        launched: false,
        would_launch: { titles: params.titles, email, phone },
        enrichable_contacts: preview.enrichable_contacts,
        credits_remaining: creditsRemaining,
        available_titles: availableTitles,
        message:
          "Enrichment not launched — awaiting confirmation. Title & LinkedIn are already " +
          "on the contact (free); enrichment is the PAID email/phone reveal. Re-call with " +
          "confirm:true (or email:true) to spend.",
        next_action:
          "Confirm the spend with the user, then call leadbay_enrich_titles again with confirm:true.",
      };
    }

    // User accepted the spend. Launch under a FRESH selection lock — the preview
    // phase cleared the selection, so launchEnrichment re-selects the same leads.
    // Use effectivePhone: the user may have opted into phone via the elicitation.
    return await launchEnrichment(
      client,
      {
        leadIds,
        titles: params.titles!,
        email,
        phone: effectivePhone,
        lensId,
        selectionSource,
        preview,
      },
      ctx
    );
  },
};
