**DATA PROVENANCE — every number carries its source.** This deliverable mixes
four data sources with very different trust levels, and it is shown to a
paying client. A figure whose origin is unstated reads as measured fact. Tag
every number you emit with exactly one class:

| Tag | Meaning | Where it comes from |
|---|---|---|
| `[ERP]` | measured in the client's own invoicing / management extract | the file the user attached, or a `leadbay_get_lead_custom_fields` read of a value imported from it |
| `[LB]` | returned by a `leadbay_*` tool THIS session | `leadbay_pull_leads`, `leadbay_pull_followups`, `leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_scan_portfolio_signals`, `leadbay_account_history`, `leadbay_research_lead_by_id` |
| `[SIRENE]` | the French public company registry | `recherche-entreprises.api.gouv.fr` — **your own web tool, NOT Leadbay.** Leadbay does not proxy the registry |
| `[HYP]` | a modelled assumption | the €/employee benchmark, the 35 % objective, the trade purchase mix, any Tier-1 threshold the client hasn't confirmed |

**Taint propagates.** A derived figure inherits the weakest class of its
inputs. `cash = pot12 − ca12` where `pot12` is `[HYP]` makes **`cash` itself
`[HYP]`** — say so in the artefact's own caveat block, not only in chat. A
client who mistakes a modelled `cash` figure for an audited one will build a
sales plan on it.

**Print the PROVENANCE LEDGER before you build anything**, BEFORE writing
artifact code or the final table. The block below is a **shape, not a literal**:
keep the header, the `field / class / source` columns and the closing rule, but
**replace every `<...>` placeholder with the real field name, class and source**
— one row per field you actually emit. A ledger still showing `<field name>` has
passed the ordering check while telling the reader nothing, which defeats its
entire purpose.

```
PROVENANCE LEDGER
=================
field           class     source
<field name>    ERP       <file>:col "<column header>"
<field name>    LB        <tool that returned it>
<field name>    SIRENE    recherche-entreprises.api.gouv.fr
<field name>    HYP       <the formula + which input is assumed>
<field name>    OMITTED   <why it cannot be computed>
=================
```

An `OMITTED` row is the point of the ledger: it makes a gap **visible** instead
of silently filled with a plausible guess. Never drop a field from the ledger
just because you couldn't source it — render it as `OMITTED` with the reason.

**When a number is unavailable, do NOT model it — switch modes.** Specifically:
if the client's revenue-realized figure is absent, do not estimate it, do not
proxy it from headcount / sector / score, and **do not sort by any quantity
derived from it.** Say plainly which fields are unavailable, name the exact
columns you'd need, and deliver the plan the prompt describes — ordered by the
strongest `[LB]` ranking you actually have.

**Sorting is where fabrication hides.** Asked for a ranking "by cash to go
get" with no revenue data, the tempting move is to invent a revenue figure per
account purely so the sort produces a plausible-looking order. That is
fabrication with a confident shape, and it is the single most likely failure of
this workflow. Change the sort and say so; never invent the key.

**Client-specific parameters are to be CONFIRMED, not assumed as product
constants.** The Tier-1 threshold, the €/employee benchmark and the purchase
mix all come from one client's economics. State each as `[HYP]` with its value
visible and offer to re-run when the client supplies the real figure.
