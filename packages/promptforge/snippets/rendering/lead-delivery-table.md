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
- Channel statuses: `delivered` → show value; `already_owned` → value +
  *(already yours)*; `masked` → "on file — reveal via channels";
  `not_requested` → omit; `failed_*` → *(no verified email/phone)*.
- No contact on the item (`contact` null): render `—` (title_gate `prefer`
  delivers such rows flagged; say so in col 2 only when contact_titles were
  requested).

**The funnel line (mandatory, after the table):**

One short line narrating the delivery honestly, built from `funnel` + `cost` +
`explain.scope_notes`:

> Matched N · examined E · qualified Q · disqualified D → **delivered X of
> the Y asked** · stopped: <stop_reason in plain words> · spent C.CC.

**Money: divide, then symbol.** Every amount (`cost.spent`,
`estimated_cost.max`, quotes) is `cost_cents` — divide by 100, two decimals,
so `165` renders `1.65`, NEVER `165.00`. Symbol from the account region: US
`$`, France `€`, unknown → bare. Never hard-code `$`: it misstates a charge.

"of the Y asked" needs `summary.items_requested`, which submit results carry
but a later `leadbay_lead_job_status` snapshot does not. Without it write
**delivered X** and stop — never back-fill Y from `matched`/`examined` (they
count candidates), never guess it.

Plain-word stop reasons: `target_reached` → omit (success), `pool_exhausted` →
"ran out of matching candidates", `max_cost` → "hit the cost cap", `quota` →
"hit an org quota", `time_budget` → "hit the 30-min time budget".

**When `delivered` is 0**: NEVER say just "no results". Render no table; give
the funnel line plus the relevant `explain.scope_notes` (the backend's own
diagnosis — vendor-vocabulary queries, pre-screen rejections), then propose
the concrete fix (reshape the seed per the craft rules, lower `min_ai_score`,
raise `max_cost`, drop a filter) as NEXT STEPS options.

**Weak batch**: when the BEST delivered `fit.score` is under 30, don't present
the table as an answer — open with "weak matches only", show at most the top
3, propose reshaping the seed/filters first. The count was filled with
barely-better-than-random candidates.

**Sanity-check every row**: (a) geo — `city`/`region` must sit inside any
requested fence; drop and call out leaks (same-named cities slip through).
(b) When `explain.seed_strategy` is `text_match_exemplars` (the standard FR
path), fit is calibrated for lead-to-lead distances, not exemplar centroids —
treat high scores skeptically and verify each row's `description`.

**Skipped items** (`skipped[]`, qualify jobs mostly): render a compact second
table `Ref → Outcome` translating `status_reason` to plain words:
`not_in_universe` → "not in the Leadbay universe (import it first)",
`low_confidence_identity` → "couldn't safely match — check `resolution.alternatives`",
`no_matching_contact` → "no contact with the requested title",
`disqualified` → "evaluated: does not fit" (evidence is in the item when owned),
`enrichment_failed` → "channel could not be sourced (not billed)".

**`items_truncated`**: rows are a PREFIX, not the batch. Say so, and offer
`leadbay_lead_job_status(job_id, since: next_since)` for the rest.

**Hide from the user:** UUIDs (keep for tool calls, never render), cursors,
`explain.model`/`intelligence_snapshot`, raw `distance`/`calibration`,
`seq`/`from_cache`, empty arrays.

{{include:linking/contact-linkedin}}
