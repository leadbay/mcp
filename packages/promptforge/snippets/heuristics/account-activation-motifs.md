**THE ACTIVATION MOTIFS.** Every account on the plan carries exactly one motif
from this closed set of six. The motif is not decoration — it decides the phone
pitch, the checklist, and whether the account belongs to the *Pilotage* engine
(already identified) or the *Conquête* engine (not yet identified). Assign it
from observable data and state the deciding evidence in one line per account.

| Motif | Assign when | Engine |
|---|---|---|
| **SAUVETAGE** | was buying steadily, has now stopped — a recent, sharp break (e.g. no order in ~60–90 days against a real history) | Pilotage |
| **PLAN DE COMPTE** | large, still active, buying broadly — the risk is complacency, not loss; plan the coming half-year and lock volume terms | Pilotage |
| **MONTÉE EN GAMME** | active but narrow — buys one product family while comparable accounts of the same size buy several; the gap is cross-sell | Pilotage |
| **RÉVEIL** | account exists, essentially dormant — long-dead history (e.g. 12+ months at zero) but the company is demonstrably still trading | Pilotage |
| **CONQUÊTE** | not present in the Leadbay known pipeline — in the addressable market, absent from the base. ⚠ Absence from Monitor is NOT proof they never bought (see below) | Conquête |
| **SUIVI** | in the known pipeline with recent activity, purchase behaviour unknown — the honest label for an active Monitor row when no order history is available | Pilotage |

**Decision order matters.** Test in this order and stop at the first match, or
a big lapsed account will be labelled RÉVEIL when it is really a SAUVETAGE:
recent sharp break → SAUVETAGE; long-dormant → RÉVEIL; never bought →
CONQUÊTE; buying broadly at scale → PLAN DE COMPTE; buying narrowly →
MONTÉE EN GAMME.

**Without order history the first five tests cannot run at all.** In that case
the split is simply: in the Leadbay known pipeline → **SUIVI** (or RÉVEIL-LB
when Leadbay activity is long dormant, labelled for what it measures); not in
the pipeline → **CONQUÊTE**. Never reach for a Pilotage motif you cannot
evidence.

**What each motif changes in the output.**

- The **pitch angle** — SAUVETAGE opens on the silence itself and offers terms
  to resume; PLAN DE COMPTE opens on the relationship and plans forward;
  MONTÉE EN GAMME opens on what comparable firms buy that this one doesn't;
  RÉVEIL asks what made them leave and offers a re-entry incentive; CONQUÊTE
  introduces the company and asks for a short first meeting — **without
  asserting no prior relationship**. Never write "we've never worked together"
  or "as a new customer" on a Leadbay-only plan: absence from the known
  pipeline is not proof they never bought, and that line told to an existing
  customer is the one mistake a rep cannot walk back. Write the pitch in the
  client's own commercial voice, naming the specific families and figures the
  account's data actually supports. **SUIVI** picks up the existing thread —
  a continuation, never an introduction and never a win-back.
- The **checklist** — three concrete, checkable next actions matching the
  motif's shape: diagnose → schedule → send-terms for SAUVETAGE; review →
  propose → open-a-family for PLAN DE COMPTE; visit-with-full-tariff → quote →
  first-order-in-the-new-family for MONTÉE EN GAMME; understand-the-departure →
  send-offer → first-order-back for RÉVEIL; reach-the-decision-maker →
  open-the-account → first-test-order for CONQUÊTE; confirm-the-state →
  identify-the-current-need → agree-a-next-step for SUIVI. When a signal exists,
  promote "exploit <the signal>" to the top of that account's checklist.

**Motif assignment depends on order history, which is ERP data.** Without the
client's extract, SAUVETAGE / PLAN DE COMPTE / MONTÉE EN GAMME / RÉVEIL cannot
be assigned from purchase behaviour — do not guess them from a lead score, a
sector, or a company's size. Two honest options, in order of preference:

**The Monitor gap — read this before assigning anything.** Four of the five
motifs (SAUVETAGE / PLAN DE COMPTE / MONTÉE EN GAMME / RÉVEIL) are purchase-
behaviour reads, and CONQUÊTE means "not in the known pipeline". A Monitor row
that is *actively* worked therefore matches none of them: it IS in the pipeline,
and without order history you cannot tell whether it buys broadly, narrowly, or
at all. Do NOT resolve that by guessing a purchase motif, and do NOT silently
drop the row.

Use a sixth, honestly-scoped label for those rows — **SUIVI** (in the Leadbay
known pipeline, recent activity, purchase behaviour unknown). Its pitch angle is
a continuation, not an introduction or a win-back: pick up the existing thread
and ask what's moving. Its checklist is confirm-the-state → identify the current
need → agree a next step. Say in the plan's legend that SUIVI exists precisely
because purchase history is unavailable, and that ERP order data would split
those rows into the four Pilotage motifs.

1. **CONQUÊTE is assignable from Leadbay alone — but say what it actually
   means.** Discover membership proves a company is **not in the Leadbay known
   pipeline**; it does NOT prove they never bought. Monitor membership is set by
   lens scoring, not by purchase history, so an existing customer who was never
   scored into the known view will appear in Discover. Without order history
   there is no way to tell the two apart.

   So label the motif for what the data supports — "fresh / not in the Leadbay
   pipeline" — and **write the pitch so it survives being wrong**: an opener
   that introduces the company works for a genuine prospect and merely sounds
   uninformed to a customer, whereas "we've never worked together" told to a
   current customer damages the relationship and the credibility of the whole
   plan. Only ERP order history can upgrade this to a true never-a-client
   claim. A Leadbay-only plan is still a legitimate *Conquête* plan — say so in
   the title rather than implying it covers the whole base.
2. A **Leadbay-activity** variant of RÉVEIL may be assigned from
   `leadbay_account_history` recency — but label it for what it measures: "no
   Leadbay-logged action in N months", never "no orders in N months". Logged
   activity is not invoicing.
