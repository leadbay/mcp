**THE FIVE ACTIVATION MOTIFS.** Every account on the plan carries exactly one
motif from this closed set. The motif is not decoration — it decides the phone
pitch, the checklist, and whether the account belongs to the *Pilotage* engine
(already identified) or the *Conquête* engine (not yet identified). Assign it
from observable data and state the deciding evidence in one line per account.

| Motif | Assign when | Engine |
|---|---|---|
| **SAUVETAGE** | was buying steadily, has now stopped — a recent, sharp break (e.g. no order in ~60–90 days against a real history) | Pilotage |
| **PLAN DE COMPTE** | large, still active, buying broadly — the risk is complacency, not loss; plan the coming half-year and lock volume terms | Pilotage |
| **MONTÉE EN GAMME** | active but narrow — buys one product family while comparable accounts of the same size buy several; the gap is cross-sell | Pilotage |
| **RÉVEIL** | account exists, essentially dormant — long-dead history (e.g. 12+ months at zero) but the company is demonstrably still trading | Pilotage |
| **CONQUÊTE** | never a client — in the addressable market, absent from the base | Conquête |

**Decision order matters.** Test in this order and stop at the first match, or
a big lapsed account will be labelled RÉVEIL when it is really a SAUVETAGE:
recent sharp break → SAUVETAGE; long-dormant → RÉVEIL; never bought →
CONQUÊTE; buying broadly at scale → PLAN DE COMPTE; buying narrowly →
MONTÉE EN GAMME.

**What each motif changes in the output.**

- The **pitch angle** — SAUVETAGE opens on the silence itself and offers terms
  to resume; PLAN DE COMPTE opens on the relationship and plans forward;
  MONTÉE EN GAMME opens on what comparable firms buy that this one doesn't;
  RÉVEIL asks what made them leave and offers a re-entry incentive; CONQUÊTE
  introduces the company and asks for a short first meeting. Write the pitch in
  the client's own commercial voice, naming the specific families and figures
  the account's data actually supports.
- The **checklist** — three concrete, checkable next actions matching the
  motif's shape: diagnose → schedule → send-terms for SAUVETAGE; review →
  propose → open-a-family for PLAN DE COMPTE; visit-with-full-tariff → quote →
  first-order-in-the-new-family for MONTÉE EN GAMME; understand-the-departure →
  send-offer → first-order-back for RÉVEIL; reach-the-decision-maker →
  open-the-account → first-test-order for CONQUÊTE. When a signal exists,
  promote "exploit <the signal>" to the top of that account's checklist.

**Motif assignment depends on order history, which is ERP data.** Without the
client's extract, SAUVETAGE / PLAN DE COMPTE / MONTÉE EN GAMME / RÉVEIL cannot
be assigned from purchase behaviour — do not guess them from a lead score, a
sector, or a company's size. Two honest options, in order of preference:

1. **CONQUÊTE is fully assignable from Leadbay alone** (never-a-client is
   exactly what the Discover view means). A Leadbay-only plan is therefore a
   legitimate, complete *Conquête* plan — say so in the title rather than
   implying it covers the whole base.
2. A **Leadbay-activity** variant of RÉVEIL may be assigned from
   `leadbay_account_history` recency — but label it for what it measures: "no
   Leadbay-logged action in N months", never "no orders in N months". Logged
   activity is not invoicing.
