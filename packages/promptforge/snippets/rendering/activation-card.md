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

Show the top **min(10, requested count)** accounts by the ranking key,
descending. If the plan holds more than the table shows, say how many more
follow; if the whole plan fits in the table, say nothing about "more" — a
top-5 request gets five rows and no dangling remainder. Four columns:

Col 3's header is **the ranking key you actually used** — never a cash label,
since cash-to-capture cannot be computed from Leadbay data:

```
| # · Account | Motif | Fit score | Why now |
```

- **Col 1** — rank number, then the company name linked to its website when one
  is known. Follow with a compact ` · `-separated pill line: city · headcount ·
  any account reference you were given.
- **Col 2** — the motif, exactly one of SAUVETAGE / PLAN DE COMPTE / MONTÉE EN
  GAMME / RÉVEIL / CONQUÊTE / SUIVI. Never invent a seventh.
- **Col 3** — the ranking signal with its provenance class, e.g. `AI 30 [LB]`.
  Tagging is not optional; an untagged figure reads as measured fact. **There is
  no money column** — cash-to-capture needs invoicing data Leadbay does not
  hold, so it stays OMITTED in the ledger rather than being modelled. A column
  of invented euros next to a client's name is the exact failure this
  deliverable must not ship.
- **Col 4** — the one-line reason to act now: the signal when there is one,
  otherwise the motif's deciding evidence. Never fill this with a
  plausible-sounding invented event; an account with nothing read shows `—`.

Sort strictly by the ranking key named in the ledger (which was printed above).

### The pitch + checklist block (part of the chat answer, not the deck)

The table alone is a shortlist, not a plan — the pitch and the three-step
checklist are what make it actionable, and the deck is **optional**, so they
cannot live only there. Under the table, render a short block per account for
the top rows (all of them when the plan is small; the top 5–10 otherwise, then
say the rest follow the same shape and offer them):

```
**<rank> · <Company>** — <MOTIF>
☎ <contact name>, <title> · <only the channels actually revealed>
> "<the motif's pitch, in the client's commercial voice>"
☐ <step 1>  ☐ <step 2>  ☐ <step 3>
```

Keep each pitch to one or two sentences a rep can say out loud, and each
checklist to three concrete, checkable actions matching that motif's shape.
When an account has a signal, lead the pitch with it and promote
"exploit &lt;the signal&gt;" to the top of its checklist.

### The interactive deck (only after the user accepts)

One card per account, ordered by the same key. Per card:

- **Header** — rank badge, company name, city · trade · headcount, and the
  ranking signal right-aligned with its class tag (e.g. `AI 30 [LB]`). No cash
  figure: the deck and the chat answer must never disagree about which fields
  exist, and a card carrying a euro the table omitted means one was modelled.
- **Motif badge** — the motif, visually distinct per motif so the deck can be
  scanned by strategy.
- **Qualification row** — the org's five questions, each with ✓ / ✗ / pending,
  labelled with the actual question text read from Leadbay. Never substitute
  invented question wording.
- **Signal line** — the event driving urgency, or omitted.
- **Action block** — the named contact with **only the channels enrichment
  actually returned** as one-tap `tel:` / `mailto:` links (the default reveal is
  email-only unless phone was requested — never emit a `tel:` for a phone that
  was never revealed; mark it omitted instead), the motif's pitch as a quoted
  line, and the three-item checklist as checkboxes.
- **Caveat block** — closing the deck: which classes fed it, an explicit line
  that `[HYP]` figures are modelled rather than measured, and which fields are
  OMITTED because Leadbay does not hold them. A missing input means an omitted
  field, never a stand-in number.

Header KPIs across the top, each carrying its provenance class: accounts on the
plan, count qualified, count with a reachable contact, count activated. **No
euro totals** — the same rule as the table, for the same reason.
