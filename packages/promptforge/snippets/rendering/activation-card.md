## RENDERING — account activation plan

Two surfaces. The **chat table** is the default answer and must stand alone as
useful. The **interactive deck** is offered, not forced (see the widget gate) —
build it only once the user accepts.

### Order on the page — ledger FIRST, then the plan

Print the PROVENANCE LEDGER (and the one-line provenance legend) **before** the
chat table, the deck, or any other part of the deliverable. The reader must know
which figures are measured and which are modelled *before* they read a ranking
built on them — a cash column read first and sourced second has already done its
damage. This ordering is the workflow contract, not a stylistic preference.

### The chat table (render immediately after the ledger)

Show the top 10 accounts by the ranking key, descending, then state how many more
the full plan holds. Four columns:

```
| # · Account | Motif | Cash to get | Why now |
```

- **Col 1** — rank number, then the company name linked to its website when one
  is known. Follow with a compact ` · `-separated pill line: city · headcount ·
  the ERP account number when it exists.
- **Col 2** — the motif, exactly one of SAUVETAGE / PLAN DE COMPTE / MONTÉE EN
  GAMME / RÉVEIL / CONQUÊTE. Never invent a sixth.
- **Col 3** — the cash figure with its provenance class, e.g. `20 800 € [HYP]`.
  Tagging is not optional; an untagged € figure reads as measured fact.
  **When the inputs for a money figure were not supplied, drop the money column
  entirely** — do not substitute an addressable-spend estimate, and do not stop
  to ask for the benchmark. Addressable spend needs a €/employee benchmark, so
  without one there is nothing to compute: the column becomes the ranking signal
  actually used (e.g. `AI 30 [LB]`), the header says so, and the money fields
  stay OMITTED in the ledger. A column of modelled euros next to a client's name
  is the exact failure this deliverable must not ship.
- **Col 4** — the one-line reason to act now: the signal when there is one,
  otherwise the motif's deciding evidence. Never fill this with a
  plausible-sounding invented event; an account with nothing read shows `—`.

Sort strictly by the ranking key named in the ledger (which was printed above).

### The interactive deck (only after the user accepts)

One card per account, ordered by the same key. Per card:

- **Header** — rank badge, company name, city · trade · headcount. Then, **only
  when the money inputs were actually supplied**, the cash figure right-aligned
  with its class tag and a one-word label. When they were not, the deck omits
  cash exactly as the chat table does — show the ranking signal used instead
  (e.g. `AI 30 [LB]`). The deck and the chat answer must never disagree about
  which fields exist: a card carrying a euro figure the table omitted means one
  of the two was modelled.
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
