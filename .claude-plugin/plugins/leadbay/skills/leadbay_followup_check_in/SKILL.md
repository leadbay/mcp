---
name: leadbay_followup_check_in
description: "Run the canonical follow-up check-in: surface KNOWN leads from the Monitor view that need re-engagement today, ranked by AI urgency, with the canonical pull_followups table layout. Trigger when the user asks \"follow up\", \"already known leads\", \"leads I haven't contacted\", \"leads in [city]\", \"before my trip\", \"this week\", \"this month\", \"what's overdue\", \"who should I re-engage\", or anything that implies pre-existing pipeline context."
---


Run the Leadbay follow-up check-in for me. Treat this prompt the same way for any equivalent ask: "leads I should follow up with", "already known leads", "what's overdue", "before my trip to [city]", "leads I haven't contacted", "who should I re-engage today".

# Resilience rules for Leadbay long-running tools

These four rules apply to every Leadbay workflow that calls `leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead`, `leadbay_import_and_qualify`, or `leadbay_enrich_titles`. **Treat timeouts and stream-closed errors as transient, not as signals to replan.**

## Rule 1 — Pin the lens

After your first `leadbay_pull_leads` call, capture `response.lens.id` into your working memory and **pass it explicitly as the `lensId` argument to every subsequent call** in this session — including any re-pulls, bulk qualifies, or research calls that accept it. (Field-name caveat: the response nests it as `lens.id`; the parameter on subsequent calls is `lensId`.) The active lens can shift between calls (5-minute client cache + backend `last_requested_lens` can change if the user touches the web UI). A lens shift mid-workflow throws away your top-10 work.

## Rule 2 — Prefer async for bulk operations

`leadbay_bulk_qualify_leads` and `leadbay_import_and_qualify` accept `wait_for_completion:false`, which returns `{status:'running', qualify_id}` immediately. Then poll `leadbay_qualify_status` (or `leadbay_import_status`) every ~10s until the job completes. **Use the async pattern by default** — the blocking default can exceed the MCP client's per-call timeout on large batches and produce a misleading `"Request timed out"` even though the server is still working.

## Rule 3 — Serialize `leadbay_research_lead` fan-out

`leadbay_research_lead` is composite and reads many sub-resources. Calling it on 10 leads in parallel can saturate the transport and produce `"Tool permission stream closed"` errors that look like permission failures but are really backpressure. **Call it sequentially**, or at most 3 in parallel. If one call fails with a stream/timeout error, retry that one call once before moving on; on a second failure, note the lead and continue — do not abandon the remaining leads.

## Rule 4 — Retry, don't replan

If a Leadbay tool returns `"Request timed out"`, `"stream closed"`, or any other transport-level error (distinct from a Leadbay-issued error payload), the work may still be running server-side. Do this in order:

1. For bulk tools — retry with `wait_for_completion:false` and poll the status tool with the returned id. Don't re-pull leads; that can shift the lens.
2. For single-lead tools — retry the same call once. If it still fails, record the lead id and continue with the rest of the workflow.
3. **Do not** switch strategies (e.g. "the endpoint is broken, let me re-pull from scratch"). The earlier work is still valid; the timeout was the wire.

If `pull_leads` itself fails and you have no prior batch, then yes — retry it, explicitly pass the lensId you captured (if any), and continue.


# PHASE 0 — RESUME CHECK

Same resume-check semantics as `leadbay_daily_check_in` Phase 0 — if you see prior phase completions in the task list, resume from the next phase instead of restarting.

# PHASE 1 — PULL THE FOLLOW-UP VIEW

Call `leadbay_pull_followups` (NOT `leadbay_pull_leads` — those are different entry points; see §1.6 of the prospecting overview). If the user mentioned a city, sector, recency window, or other filter, build a `FilterItem` and pass it as `set_filter` so the result is narrowed (and the filter persists for the user's next session). If the user said something generic ("anyone I should follow up on?"), call with no `set_filter` to get the default Monitor view.

For geo filters specifically: resolve the user's city name to an `admin_area_id`. The MCP doesn't yet expose an admin-area lookup, so in the interim ask the user to pick the geo from the Leadbay app's filter UI if the city isn't in the popular-cities lookup — do NOT guess an id.

# PHASE 2 — RENDER THE CANONICAL TABLE

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


## RENDERING — follow-ups table, status-badge driven

Markdown table with FOUR columns, sorted by `last_monitor_action_at` desc. **NO score bar in this view** — discovery owns the `▰❖▱` visual identity; follow-up uses status badges. Active-pushback leads are already excluded server-side.

**Active-filters line** ABOVE the table, ` · `-separated chips from `active_filters.criteria`:

| Criterion type        | Chip                       |
|-----------------------|----------------------------|
| `location_ids`        | 📍 \<resolved name\>       |
| `sector_ids`          | 🏷 \<sector name\>         |
| `keywords`            | 🔍 \<keyword\>             |
| `size`                | 👥 \<min\>–\<max\>         |
| `last_action_date`    | 📅 \<window\>              |
| `last_action`         | 🎯 \<action types\>        |
| `liked` / `yc`        | ⭐ liked / 🏅 YC           |
| `custom_field*`       | ⚙ \<field name\>          |

Render `*No filters applied.*` when empty.

**Column 1 — Status** (DERIVED from existing fields, priority order):

1. `epilogue_status == "EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED"` → 🎯 Meeting booked
2. `epilogue_status == "EPILOGUE_COULD_NOT_REACH_STILL_TRYING"` → ⚡ Trying to reach
3. `epilogue_status == "EPILOGUE_STILL_CHASING"` + last_prospecting_action_at within 14d → 🟢 In progress
4. `epilogue_status == "EPILOGUE_NOT_INTERESTED_LOST"` → ❄ Not interested (usually filtered out)
5. `epilogue_status == null` + `last_prospecting_action_at == null` → ✨ New
6. `epilogue_status == null` + `last_prospecting_action_at > 60d` → 💤 Dormant
7. Otherwise → 🔥 Hot

Append `<relative time>` of `last_monitor_action_at` (`today`/`Nd`/`Nw`/`Nmo`). For ✨, show `new`. Line 2: **[Company](website)** bold. Line 3: short location · compact size.

**Column 2 — AI take** (3 lines from `split_ai_summary` verbatim, `<br>`-separated):

- Line 1: emoji + **bold split_ai_summary.worth_pursuing**. Emoji from leading word: `Yes…`→✅, `No…`→❌, `Maybe…`→🤔, else→💡.
- Line 2: *italic split_ai_summary.approach_angle* (≤ 18 words).
- Line 3: **Next:** split_ai_summary.next_step.
- Fallback when null: render `ai_summary` italic, no emoji.

**Column 3 — History & notes**

- Line 1: `<relative time> ago · <last_prospecting_action>` (humanize: snake_case → Title Case; drop `LEAD_` prefix). When null: `*Never touched.*`
- Line 2 (when `epilogue_status` set): `📌 Outcome: <user-facing label> · <relative time>` — NEVER show the wire-format `EPILOGUE_*` value.
- Line 3 (when a recent note surfaces): `📝 *<note clipped ≤ 14 words>* (<rel time>)`.
- If neither: `*0 prior touches · 0 notes*`.

**Column 4 — Contacts** (max 3 lines, recommended_contact first):

```
★ [Name](linkedin_page or people-search) · ☎ phone · 📧 email
```

Markers: `★` recommended, `💎` hot in web_insights key_people. Channel pills: `☎ phone` (rec.phone_number → lead.phone_numbers[0] `(co)` → `⚪ phone`); `📧 email` (rec.email → `⚪ email`). When no visible contact has email/direct phone: append `*enrich first*` in italic.

**Hide:** `id`, `location.pos`, `web_fetch_in_progress`, `enrichment_in_progress`, `stale_at`, `sector_id`, zero counters, `social_presence` booleans (except °-flag), `score`, string `"null"`.

**Legend** (user-facing — NEVER say "epilogue"):

🎯 Meeting booked · ⚡ Trying to reach · 🟢 In progress · 💤 Dormant · ✨ New · 🔥 Hot · ❄ Not interested · ★ recommended · 💎 hot in web_insights · ☎ (co) = company line · ⚪ not enriched

## Linking a contact's name

Two LinkedIn URLs exist and must never be conflated: the **company's** LinkedIn page and an **individual person's** profile.

When the response carries a real contact LinkedIn URL — `contact.linkedin_page` is a string that starts with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it) — link the contact's name to that URL.

Otherwise fall back to a LinkedIn people-search URL:

```
https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>
```

URL-encode the params. Strip Inc / LLC / Corp / Ltd / GmbH suffixes from the company name. Append a trailing ` °` to the rendered name ONLY when the fallback is in use AND `social_presence.linkedin == false` (no company LinkedIn → search may not resolve). Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa). The two surfaces are different — conflating them quietly degrades the workflow.

## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname. (The MCP does NOT synthesize a Leadbay-app deep-link URL; the team has not standardized one. Linking to `website` is always real data.)

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).



ABOVE the table, add a 1–3 sentence "Where to start today" paragraph that names the single highest-urgency row and explains why (recent hot signal, overdue commitment, never-touched-but-strong-fit, etc.) — speak to urgency and momentum. Do NOT repeat the AI take column from the table.

# PHASE 3 — DEEP DIVE (only if user asks)

Unlike `leadbay_daily_check_in` which deep-dives on every promising lead in Phase 4, this prompt waits for the user to point at a row. Reason: follow-up batches are typically larger and the user is triaging recall, not researching cold.

When the user picks a row, call `leadbay_research_lead` on that single lead (or `leadbay_research_company` if they only have the name) and offer to `leadbay_prepare_outreach` once they say "let's reach out".

# CROSS-MODE PIVOT

Below the table, offer the cross-mode pivot in one short line so the user can redirect if you guessed wrong on entry-point routing: "Want to see NEW leads from your wishlist instead?" — that routes back to `leadbay_daily_check_in` (Discovery via `leadbay_pull_leads`).

# GATE — STOP

IRON LAW — DO NOT TAKE OUTBOUND ACTION. Do not call `leadbay_report_outreach`. Do not draft an outreach message into a tool argument. Outreach is the user's call after they've reviewed the follow-up list.

Render this acknowledgment VERBATIM as the last line of your message:

```
STOP — awaiting user decision. I will not take any further action until you tell me what to do next.
```

Do not propose a next action. Do not call any more tools. Hand control back to the user.
