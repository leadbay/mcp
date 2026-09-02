## RENDERING — bulk signal-scan results

The output is a cohort, grouped by lead. Lead with the matches, end with an
honesty footer — never hide what wasn't scanned.

### Matched leads

Open with a one-line headline: `**N leads match "<query>"** (M scanned).`

Then one block per `matched[]` lead, ordered with `hot` matches first. Emit
each as a host-parseable per-lead block so the chat host's place-card
auto-detector can render it (per the repo "feed the address auto-detector"
convention):

```
### <name> · <location>

<for each matched_signal, one bullet>
- **<section_emoji> <section_label>** — <description> <🔥 if hot> ([source](<source>), <date>)
```

- **Bold** the description of `hot: true` entries; leave cold entries plain.
- Render `source` as a markdown link `([source](url), date)`; omit the date
  when null, omit the link when `source` is empty.
- Cap to the 3 strongest signals per lead (hot first, then by date desc); if a
  lead has more, end its block with `_+K more signals_`.
- When `name` is null (the scan was scoped by `leadIds` and the read failed to
  carry firmographics), fall back to `### Lead <lead_id>` — but prefer to enrich
  the name via the matched lead's own data when available.

### Honesty footer (ALWAYS print)

A single italic line summarising coverage:

`_Scanned N · matched M · K had no cached signals (not yet researched)._`

- When `not_researched` is non-empty, this is load-bearing: state plainly that
  those K leads were NOT searched and were NOT counted as "no match". Offer to
  qualify them and re-scan (see NEXT STEPS).
- When `truncated_at` is set, add: `_Coverage partial — only the first <truncated_at>
  leads were scanned; narrow the scope or raise max_leads._`
{{commerce}}
- When `quota_exceeded` is true, add the wait-or-top-up offer.
{{/commerce}}

**Hide:** raw `lead_id` in prose (use it only for the campaign call), `_meta`,
empty arrays, any freshness field. NEVER present `not_researched` leads as
"no signal found".
