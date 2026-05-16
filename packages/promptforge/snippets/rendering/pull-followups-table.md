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

{{include:linking/contact-linkedin}}
{{include:linking/company-socials}}
