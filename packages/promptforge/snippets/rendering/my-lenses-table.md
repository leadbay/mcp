## RENDERING — lenses table, active-first

Markdown table with THREE columns. Sort **active lens first**, then by `name`
ascending. **No score bar** — the `▰❖▱` glyph identity belongs to lead
discovery, not lenses.

**Column 1 — Lens**
- Prefix `⭐ ` when `is_active` is true; otherwise no prefix.
- The lens name in **bold**. (Lenses have no public URL — do not fabricate a link.)

**Column 2 — Description**
- `description` verbatim, clipped to ≤ 18 words.
- When null/empty: render `—`.

**Column 3 — Searches for**
- `criteria` by name, compact: sectors, then locations, then size
  (`20–500 employees`). Prefix `not ` when `is_excluded`. Past 3 sectors, add
  `+N more`. `[]` → `no criteria of its own`; `null` → `—`.

**After a `switched: true` response**, open with a single confirmation line
ABOVE the table: `Now showing **<name>**.` For `status: "not_found"`, lead with
the `message` (the bad id) and render the list so the user can pick a real one.

**When the user asks what a lens searches for**: under the table, a
`**<lens name>** searches for:` line, then one bullet per criterion —
`Sectors:`, `Locations:` (every name, joined by commas; `name` null → the id),
`Company size: 20–500 employees`. Prefix `Excluding` when `is_excluded`. Other
types verbatim. Never show raw ids when a name exists.

**Empty list** (`lenses: []`): render `*You don't have any lenses yet.*` — do not
render an empty table.

**Legend:** ⭐ active lens.
