## RENDERING — account activation plan

Two surfaces. The **chat table** is the default answer and must stand alone as
useful. The **interactive deck** is offered, not forced (see the widget gate) —
build it only once the user accepts.

### The chat table (always render this first)

Show the top 10 accounts by `cash` descending, then state how many more the full
plan holds. Four columns:

```
| # · Account | Motif | Cash to get | Why now |
```

- **Col 1** — rank number, then the company name linked to its website when one
  is known. Follow with a compact ` · `-separated pill line: city · headcount ·
  the ERP account number when it exists.
- **Col 2** — the motif, exactly one of SAUVETAGE / PLAN DE COMPTE / MONTÉE EN
  GAMME / RÉVEIL / CONQUÊTE. Never invent a sixth.
- **Col 3** — the cash figure with its provenance class, e.g. `20 800 € [HYP]`.
  Tagging is not optional; an untagged € figure reads as measured fact. In
  degraded mode this column becomes the addressable-spend estimate and the
  header must say so.
- **Col 4** — the one-line reason to act now: the signal when there is one,
  otherwise the motif's deciding evidence. Never fill this with a
  plausible-sounding invented event; an account with nothing read shows `—`.

Sort strictly by the ranking key named in the ledger. Print the provenance
legend once below the table, and immediately after it the PROVENANCE LEDGER.

### The interactive deck (only after the user accepts)

One card per account, ordered by the same key. Per card:

- **Header** — rank badge, company name, city · trade · headcount, and the cash
  figure right-aligned with its class tag and a one-word label.
- **Motif badge** — the motif, visually distinct per motif so the deck can be
  scanned by strategy.
- **Family bars** — one row per product family: a filled bar for revenue already
  realized and a visually distinct (hatched or outlined) extension for the
  additional potential, plus the € values. These are **static markup** built
  from the imported data — there is no live tool behind them. Omit this block
  entirely in degraded mode rather than drawing a bar with no realized value.
- **Qualification row** — the org's five questions, each with ✓ / ✗ / pending,
  labelled with the actual question text read from Leadbay. Never substitute
  invented question wording.
- **Signal line** — the event driving urgency, or omitted.
- **Action block** — the named contact with phone and email as one-tap
  `tel:` / `mailto:` links, the motif's pitch as a quoted line, and the
  three-item checklist as checkboxes.
- **Caveat block** — closing the deck: which classes fed it, the benchmark and
  Tier-1 threshold used, and an explicit line that `[HYP]` figures are modelled,
  not measured. If any input was a placeholder, say so here.

Header KPIs across the top: total cash on the plan, total upsell potential,
count qualified, count activated. Each carries its provenance class.
