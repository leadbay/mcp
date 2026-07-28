## RENDERING — delivery table + honest funnel line

Render delivered leads (`leads[]`, i.e. items with status `delivered` or
`degraded`) as a markdown table **in the order returned**. Exactly three
columns. Then ALWAYS close with the funnel line (below) — even, especially,
when nothing was delivered.

**Column 1 — Company**

- Line 1: 10-segment fit bar in inline-code backticks from `lead.fit.score`
  (0-100): `filled = round(score/10)`, glyphs `▰` filled / `▱` empty. When
  `lead.fit.components.qualification.available` is true AND `ai_score > 0`,
  replace the LAST filled segment with `❖` (AI-confirmed cap). When
  `fit.available` is false, render `▱▱▱▱▱▱▱▱▱▱` and say "unscored" in col 2.
  Never print the numeric score.
- Insert `<br>`, then: linked company name (target `company.website`, bare
  hostnames get `https://`; unlinked plain text when absent) + ` · ` + short
  location (City, ST / City, Country) + ` · ` + employees as `min–max` (omit
  when `employees.known` is false).

**Column 2 — Why it fits**

- One sentence ≤ 20 words. Priority: `fit.reasoning` → gist of
  `company.description` → top `fit.components.qualification.matched_tags`.
- If the item status is `degraded` or a requested channel failed, append the
  honest flag in italics, e.g. *(email could not be sourced)*.

**Column 3 — Contact**

- `[Name](linkedin) · role` (linked name mandatory when a LinkedIn URL
  exists; plain name otherwise). Below it, the PURCHASED channels only:
  `✉ value` / `☎ value` inline as plain text (they auto-linkify).
- Channel status semantics from `contact.channels.{email,phone}.status`:
  `delivered` → show value; `already_owned` → show value + *(already yours)*;
  `masked` → "on file — reveal via channels"; `not_requested` → omit;
  `failed_previously`/`failed_now` → *(no verified email/phone)*.
- No contact on the item (`contact` null): render `—` (title_gate `prefer`
  delivers such rows flagged; say so in col 2 only when contact_titles were
  requested).

**The funnel line (mandatory, after the table):**

One short line narrating the delivery honestly, built from `funnel` + `cost` +
`explain.scope_notes`:

> Matched N · examined E · qualified Q · disqualified D → **delivered X of
> the Y asked** · stopped: <stop_reason in plain words> · spent €C.CC.

Plain-word stop reasons: `target_reached` → omit (success), `pool_exhausted` →
"ran out of matching candidates", `max_cost` → "hit the cost cap", `quota` →
"hit an org quota", `time_budget` → "hit the 30-min time budget".

**When `delivered` is 0**: NEVER say just "no results". Render no table; give
the funnel line plus the relevant `explain.scope_notes` (they carry the
backend's own diagnosis, e.g. vendor-vocabulary queries or pre-screen
rejections), then propose the concrete fix (reshape the seed per the
example_lead craft rules, lower `min_ai_score`, raise `max_cost`, drop a
filter) as NEXT STEPS options.

**Skipped items** (`skipped[]`, qualify jobs mostly): render a compact second
table `Ref → Outcome` translating `status_reason` to plain words:
`not_in_universe` → "not in the Leadbay universe (import it first)",
`low_confidence_identity` → "couldn't safely match — check `resolution.alternatives`",
`no_matching_contact` → "no contact with the requested title",
`disqualified` → "evaluated: does not fit" (evidence is in the item when owned),
`enrichment_failed` → "channel could not be sourced (not billed)".

**Hide from the user:** UUIDs (`lead_id`, `contact_id` — keep them for tool
calls, never render), `next_since` cursors, `explain.model`,
`explain.intelligence_snapshot`, raw `distance`/`calibration`, per-item
`seq`/`from_cache`, empty arrays, `estimated_cost` when equal to spent.

{{include:linking/contact-linkedin}}
