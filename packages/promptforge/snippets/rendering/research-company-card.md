## RENDERING — single-record research card, mode-adaptive

Present as a single-record card, not a table. This tool gets invoked in two distinct user contexts — detect which and adapt the body density accordingly.

**MODE A — Discovery.** The user is evaluating whether to pursue this company as a target. Signals: "tell me about", "what do they do", "is this a fit", "research [company]", arrival via a click-through from `leadbay_pull_leads`, no prior outreach context in the conversation. Next step is usually qualify, deep-dive via `leadbay_research_lead`, or decide whether to start outreach.

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

{{include:linking/contact-linkedin}}
{{include:linking/company-socials}}
