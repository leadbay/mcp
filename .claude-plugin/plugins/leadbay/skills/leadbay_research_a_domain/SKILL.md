---
name: leadbay_research_a_domain
description: "Resolve a company by name or domain across the user's visible Discover, Monitor, and Activate corpus, then return everything Leadbay knows about it."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


IRON LAW — NO FABRICATION. Every lead id, contact email, custom field id, mapping decision, and tool argument must trace to a value you read from the file the user attached or to an output from a leadbay_* tool call in this session. Do not invent values. Do not "fill in" a missing leadId with a name match. Do not synthesize a CRM id from a guess. If a value is missing, leave the field blank and say so.


GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


Research the company name or domain '<Company name or domain (for example 'Acme Corporation' or 'acme.com'). The legacy argument key remains `domain` for client compatibility. If not provided in the user's most recent message, ask once before proceeding.>' for me using Leadbay.

# PHASE 1 — RESOLVE + DEEP DIVE
Call `leadbay_research_lead_by_name_fuzzy` with
`companyName:'<the domain (as extracted above)>'`. Omit `lensId`: the default search deliberately
covers the user's visible Discover, Monitor, and Activate corpus, including
other lenses and leads outside the active lens's first page. The composite
resolves the lead and returns the full deep-research payload in one call.

Render the result using the canonical single-record card layout — detect MODE A
(Discovery) since the user asked to research a company rather than prepare
outreach:

## RENDERING — single-record research card, mode-adaptive

Present as a single-record card, not a table. This tool gets invoked in two distinct user contexts — detect which and adapt the body density accordingly.

**MODE A — Discovery.** The user is evaluating whether to pursue this company as a target. Signals: "tell me about", "what do they do", "is this a fit", "research [company]", arrival via a click-through from `leadbay_pull_leads`, no prior outreach context in the conversation. Next step is usually qualify, deep-dive via `leadbay_research_lead_by_id`, or decide whether to start outreach.

**MODE B — Contact preparation.** The user is about to call or email someone at this company and needs the talking points. Signals: "I'm calling them", "draft an email", "before my call", "outreach prep", "what should I say", or the conversation has already touched on a specific contact. Next step is usually `leadbay_prepare_outreach`.

Default to MODE A when uncertain. Always offer the cross-mode pivot at the end so the user can redirect if you guessed wrong.

### Common structure (both modes)

- **Header** (H4 or H5): `<10-segment score bar>` `[Company name](website)`. Use the score-bar algorithm; the bar lives in a single inline-code span. Prefix `https://` to website if it's a bare hostname.
- **Pill row** (immediately below the header): short location · compact size · social pill chips iterated over `social_urls` (each non-null platform becomes `[<platform-label>](<url>)`) · `[website-domain](website)` · `☎ phone` when `phone_numbers[]` is non-empty (use the first number). All ` · `-separated.
- **Blurb**: render `description` (preferred) or `short_description` as a single blockquoted paragraph.
- **Staleness line**: italic, `"Researched <relative time>"` from `web_insights_fetched_at`. Use `"today"` / `"yesterday"` / `"N days ago"` up to 30 days, then absolute date. Prefix with `⚠` if older than 30 days.
- **Contacts table** (always at the bottom):
  ```
  |   | Name | Title | LinkedIn |
  ```
  Markers in column 1:
  - `★` — `recommended_contact` match.
  - `💎` — name fuzzy-matches a `hot: true` entry in `web_insights` key_people. (Use `💎`, not `🔥`, to avoid glyph collision with the follow-up status badge.)
  Sort `★` first, then `💎`-only rows, then API order. Link the name via `linkedin_page` first; fall back to LinkedIn people-search with `<First>+<Last>+<Company>`. Append `°` only when the fallback is in use AND `social_presence.linkedin == false`. Cap to 6 rows; if `contacts_count > shown`, end with `"+N more — ask to see the full list"`.

### MODE A body (Discovery, fuller, scannable)

Render each non-empty `web_insights` section as H5 with the emoji + label intact. Section order: `🏢 company profile` → `📈 business signals` → `💡 prospecting clues` → `🧩 strategic positioning` → `🔎 technologies & innovation`. Inside each, bullet 3–5 items. Sort `hot: true` items first. **Bold** the description text of hot items; leave cold items plain. Render `source` as `[source](url)` at the end; include `date` when present. Omit empty sections. Skip `🔗 social links` (already in the pill row) and `👤 key people` (already in the contacts table).

### MODE B body (Contact preparation, tighter)

Render exactly two H5 sections:

##### 🎯 Conversation hooks

Distill the 3 most recent / most hot signals from `📈 business signals` and `💡 prospecting clues` into one-sentence talking points in salesperson voice. Strip the academic framing. Cite the source inline.

##### 👤 About the person *(only when recommended_contact is non-empty)*

2-line summary: their title + any context from `web_insights` key_people. If they appear in a hot signal ("X appointed CEO"), surface that prominently.

Skip 🏢 profile, 🧩 strategic positioning, 🔎 technologies in MODE B — context the user doesn't need for the next 30 seconds.

If `qualification[]` is non-empty, append one collapsed line: `"Qualification: N questions answered, avg boost X"` and offer to expand in NEXT STEPS.

**Hide:** `id`, `lead.id`, `contact.id`, `lead.location.pos`, `web_fetch_in_progress`, `enrichment_in_progress`, `recommended_contact_title` (duplicates `recommended_contact.job_title`), empty arrays, fields whose value is the string `"null"`, `contact.source` (internal), insights whose `source` is empty.

**Legend (print once below the card):** `` `▰` firmographic · `❖` AI booster · `▱` unfilled · ★ recommended · 💎 hot in web_insights · ° = no company LinkedIn (fallback link only) ``

## Linking a contact's name

**MANDATORY: every contact name in your output — table cells, prose, headers, "Reach <Name>" callouts — MUST be wrapped in markdown link syntax `[Name](URL)`. Never render a contact name as bare text. A plain-text name is a broken contact card; the underlined name is the user's primary affordance for "take me to this person's profile". No "no URL available" exception — the search URL below is always constructable from name + company.**

URL priority (first applicable wins):

1. **Real profile** — `contact.linkedin_page` when it's a string starting with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it).
2. **Constructed people-search** — `https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>`. URL-encode params. Strip Inc / LLC / Corp / Ltd / GmbH / Co / S.A. / S.L. / PLC / AG / SAS / SARL suffixes from the company. Append a trailing ` °` to the rendered name ONLY when this fallback is in use AND `social_presence.linkedin == false`. Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa) — the two surfaces are different and conflating them quietly degrades the workflow.

## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname. (The MCP does NOT synthesize a Leadbay-app deep-link URL; the team has not standardized one. Linking to `website` is always real data.)

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).



# PHASE 2 — NOT FOUND
If the resolver returns `LEAD_NOT_FOUND`, say that the existing visible corpus
was searched. **Do NOT call `leadbay_import_and_qualify` automatically.** Offer
to import and qualify the company as a separate, explicit next step; only call
it after the user agrees.

# PHASE 3 — SUMMARY
Place a 2–3 sentence summary ABOVE the card with:
- Who is this company (1 sentence)
- Their fit (cite specific qualification answers or signals from the research response)
- Which contact would I email first (one short clause — the card's contacts table carries the rest)

The card itself handles the signal callouts (`📈 business signals`, `💡 prospecting clues`). Do NOT re-narrate signals in prose above the card — that's what the card sections are for. Be honest about uncertainty: if any field is missing from tool responses, say "not surfaced by qualification" rather than guessing.
