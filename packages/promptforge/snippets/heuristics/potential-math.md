**POTENTIAL MATH — what an account could be worth.** The plan ranks accounts by
the money still on the table, not by score. Three quantities, in order:

1. **Addressable spend** — `marché = headcount × benchmark`, where `benchmark`
   is the client's own measured €/employee/year for their customer base.
   Headcount comes from Leadbay (`size` on a lead) or the registry `[SIRENE]`.
2. **Year-1 objective** — `pot12 = max(0.35 × marché, ca12 × 1.3)`: take about
   a third of the addressable spend, or 30 % growth on what the account already
   buys, whichever is higher. Never let the objective fall below current spend.
3. **Cash to go get** — `cash = pot12 − ca12`. This is the ranking key, and the
   headline number on every card.

Per-family split: distribute `marché` across product families using the typical
purchase mix for that trade, then per family `gap = pot − real`. The families
with `real = 0` and a non-trivial `pot` are the cross-sell targets — they are
what MONTÉE EN GAMME acts on.

**Every one of these is `[HYP]` unless the client supplied the input.** The
benchmark, the 0.35 objective ratio, the 1.3 growth floor and the trade mix are
all modelling choices. `marché` and `pot12` are therefore always `[HYP]`; `cash`
is `[HYP]`-tainted because `pot12` is. Only `ca12` and per-family `real` can
ever be `[ERP]`. State the benchmark value you used, visibly, every time —
a €/employee figure carried over from a different client is the most common way
this math goes silently wrong.

**Ask for the benchmark; don't invent one.** If the client hasn't given it, ask
for the median €/employee/year across their existing customers — they can
usually compute it from the same extract. If they can't supply it, you may
proceed with a clearly-labelled placeholder ONLY if you state it as an
assumption on the artefact itself and say the ranking will shift once the real
figure lands. Never present a placeholder-derived € figure as measured.

**TIER-1 DEFINITION — one definition, everywhere.** A Tier-1 account is one
that buys at or above the client's own significance threshold — for example
`≥ 10 k€/year OR ≥ 24 orders/12 months`. Two rules:

- **This is a client-specific parameter, not a Leadbay constant.** The example
  figures come from one distributor's economics. Confirm the client's own
  threshold and use it; mark it `[HYP]` until they confirm.
- **Use a single definition in every section of every deliverable.** A
  Tier-1 that means one thing in the market sizing and another in the
  penetration table makes the whole document unusable, and it is the most
  common defect in hand-built versions. If asked to use two different
  thresholds, refuse and explain why one must hold throughout.

**Tier-1-*capable*** is a different claim from Tier-1: it estimates which
companies *could* reach the threshold, proxied by headcount (e.g. `≥ 6
employees`). Capable is `[HYP]`/`[SIRENE]`-derived; actual Tier-1 status is
`[ERP]`-measured. Never present one as the other — the gap between them is the
entire opportunity being sold.
