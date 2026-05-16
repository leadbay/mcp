---
name: leadbay_qualify_top_n
description: "Bulk-qualify the top N un-qualified leads in the active lens. Uses leadbay_bulk_qualify_leads with a sensible default budget."
---


Qualify the top <the user-supplied value if any; otherwise a sensible default. Source: How many leads to qualify (default 10, max 25). Higher counts may take 5+ minutes.> un-qualified leads in the active Leadbay lens.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# PHASE 1 — LAUNCH
Call `leadbay_bulk_qualify_leads` with `count=<the count_or_default (as extracted above)>`.

# PHASE 2 — POLL
While it polls, expect notifications / progress events showing per-lead transitions. Surface meaningful ones (e.g. "lead X just finished") to me as they arrive — one inline status sentence per check, never expanded into a card:

## Status / scalar — single-sentence shape

The response is a status confirmation or scalar — render exactly one sentence inline. Do NOT emit a card or a table. Do NOT enumerate the affected records (that's the next tool's job).

Template patterns to follow:

- Job kicked off → `"✓ <Verb> N <noun(s)> — typically ~M minutes. I'll refresh when it's done."`
- No work needed → `"All N <noun(s)> already <state> — no work to do."`
- Long-running → `"⏳ <Verb> still running — N% complete; check back in ~M minutes."`
- Failure → `"⚠ <Verb> failed: <error>. <recovery hint>"`

After the status line, propose the obvious refresh / progress-check / recovery action in the NEXT STEPS block. Never expand the status into a card.


# PHASE 3 — SUMMARIZE

When `bulk_qualify_leads` returns, surface results in two parts.

**Status line first** — one sentence using the status-inline shape above: how many qualified, how many are still running (name them by lead_id + lead name if available so the user can poll later).

**Then a refreshed table** — re-pull the newly-qualified leads via `leadbay_pull_leads` with the same `lensId` and render them using the canonical pull_leads layout:

## RENDERING — markdown table, three columns, score-bar driven

Present the response as a markdown table sorted by `score` descending, with exactly three columns. Do not summarize in prose. Do not show the numeric score anywhere.

## Score-bar (10-segment, inline-code wrapped)

Wrap a 10-glyph bar in a SINGLE inline-code span (backticks). The inline-code styling is what gives the bar contrast in most chat renderers — HTML `<span>` is stripped inside table cells.

Glyphs (use these exact characters; do not substitute):

- `▰` — firmographic-only fill
- `❖` — AI-booster cap (placed at the RIGHT END of the filled run, never the front)
- `▱` — empty

Computation:

```
total_filled  = round(score / 10), clamped to 0..10
ai_segments   = round(qualification_summary.avg_qualification_boost / 3.3),
                clamped to [0, total_filled]
normal_filled = total_filled − ai_segments
bar = "▰" × normal_filled
    + "❖" × ai_segments
    + "▱" × (10 − total_filled)
```

If `qualification_summary.answered == 0` or `avg_qualification_boost` is null, set `ai_segments = 0` (no ❖). Always wrap the bar in backticks. Print the legend `` `▰` firmographic · `❖` AI booster cap · `▱` unfilled `` once below the table.


**Column 1 — Company**

- Line 1: the 10-segment score bar in inline-code backticks (see the score-bar snippet above for the algorithm).
- Insert `<br>` between lines.
- Line 2: linked company name + ` · ` + short location + ` · ` + compact size.
  - Link target: `website` (prefix `https://` if it's a bare hostname). Don't synthesize an app deep-link.
  - Location: shorten "City of New York" → "NYC"; otherwise "City ST"; state alone only when city missing.
  - Size: `"Xk+"` when `size.min >= 1000`, `"min–max"` otherwise.

**Column 2 — Why it fits**

- One sentence, ≤ 20 words.
- Synthesize from (in priority order, whichever is present) the lead's `short_description`, top 2 `tags[].display_name`, and the gist of `qualification_summary.best_response_excerpt`. The trim payload does NOT carry the longer `description` field — for that, agent must call `leadbay_research_lead` or `leadbay_research_company`.
- Do NOT append `(boost N)` — the ❖ cap in column 1 already carries that signal.
- No bullet lists, no line breaks inside the cell.

**Column 3 — Contact**

`[Contact name](LINK) · short job title`. See linking/contact-linkedin for LINK priority and the °-flag fallback.

**Hide from the user (never include in any cell):** `id`, `location.pos`, `location.country` (unless city/state both missing), `sector_id`, `is_hq`, `web_fetch_in_progress`, `enrichment_in_progress`, `highlighted_fields`, `custom_fields`, `contacts_count` when 0, `notes_count` / `epilogue_actions_count` / `prospecting_actions_count` when 0, `stale_at`, `deal_insights`, `social_presence` booleans (except as the °-flag signal), `need_attention` flags, any field whose value is the string `"null"`.

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



ABOVE the table, add a 1–2 sentence "Standouts from this batch" line that calls out the 3 highest-`ai_agent_lead_score` rows — this is supplementary commentary, not a replacement for the table.

# PHASE 4 — RECOMMEND
Recommend the single most-promising lead from this batch and offer to research it deeply with `leadbay_research_lead`. Do not actually call `research_lead` yet — wait for my go.
