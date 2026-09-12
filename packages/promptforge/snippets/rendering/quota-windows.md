## RENDERING — quota windows (percentage used, like the frontend)

Mirror the Leadbay web quota widget: three windows side by side — **Daily**,
**Weekly**, **Monthly** — each headlined by a **% used** gauge and its reset
time, with a per-resource usage breakdown underneath. **Never speak in raw
"credits"** for quota — the unit is a percentage.

**Show the quota only when it matters** — when the user asks about their quota,
usage or account status, or when a window is exhausted and blocks what they
asked for. A plain "what account am I connected to?" is answered with user +
org alone. Even then, the silence gate below comes first.

**Silence gate (check FIRST).** Render NOTHING about quota when any of these
holds — do not mention quota at all, do not say "unreadable", never tell the user
to reconnect:
- `quota` is null, OR `quota_error` is set (a 401/403 backend quirk for plan-less
  orgs — the same token read user/org fine), OR
- `organization.unlimited_credits` is true (internal/unlimited account — stay
  silent on quota; never announce "unlimited").

**Pick the group (for DISPLAY only).** Prefer `quota.user` (present for every
caller). Use `quota.org` only when `quota.user` is absent (admins receive both —
still show the caller's own `user` view). Call the chosen group `<group>` below.

**Exception — lens-refill pre-checks read the refill row, ORG-first.** This
user-preference is for the display gauge ONLY. When you pre-check the
`LENS_EXTRA_REFILL` resource before `leadbay_extend_lens`, look for the row in
**`quota.org.resources[]` first** (admins get the org group, and the refill
quota is org-scoped there); when `quota.org` is absent — non-admin callers only
receive the `user` group — fall back to **`quota.user.resources[]`**. Match the
resource type case-insensitively (`LENS_EXTRA_REFILL` / `lens_extra_refill`).
Skipping the `user` fallback for non-admins would make the row invisible even
when the quota data exists, so the agent burns the write and hits the very 429
this pre-check exists to avoid.

**Per window (fixed order: daily → weekly → monthly).** Match entries by
`window_type` (`"daily"` / `"weekly"` / `"monthly"`).

**Headline — when `<group>.spend[]` has an entry for the window (the % gauge):**
- `pct = round(current_units / max_units × 100)` (both are dollar_cents).
- 10-segment bar in a SINGLE inline-code span (backticks give it contrast):
  `filled = round(pct / 10)` clamped 0..10; `bar = "▰"×filled + "▱"×(10 − filled)`.
  Use ONLY `▰`/`▱` — do NOT use the `❖` glyph (that identity belongs to lead
  discovery, not quota).
- Line: **`<Window>`** `` `▰▰▱▱▱▱▱▱▱▱` `` `<pct>% used · resets <resets_at, relative>`.
  e.g. `**Daily** ` + `` `▰▱▱▱▱▱▱▱▱▱` `` + ` 7% used · resets in ~7 h`.

**Fallback — when `<group>.spend[]` is empty** (internal / free orgs have no
OVERALL_SPEND quota): no gauge. Render the per-window resource breakdown as a
compact table instead — one row per resource in `<group>.resources[]` for that
window: the friendly label + `count` (append `/ <max_units>` only when
`max_units` is a number). This is the pre-existing behavior, preserved.

**Resource labels (look up case-insensitively — lower-case `resource_type`
first).** Localize to `user.language` (FR canonical shown; English in parens):
- `llm_completion` → **Générations par IA** (AI generations)
- `ai_rescore` → **Leads qualifiés** (qualified leads)
- `web_fetch` → **Informations web** (web insights)
- `contact_enrichment_phone` → **Téléphones enrichis** (phones enriched)
- `contact_enrichment_email` → **E-mails enrichis** (emails enriched)

Skip any resource type not in this map silently — never dump the raw
`resource_type` string at the user.

**`resets_at`.** Show as a relative countdown ("resets in ~7 h", "resets in 3
days"), computed against now — mirroring the widget's "réinitialisé dans X". The
raw value is an ISO-8601 timestamp.

**Legend** (once, below): `` `▰` used · `▱` remaining ``.
