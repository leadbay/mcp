---
name: leadbay_top_accounts_to_activate
description: "Build a ranked account-conquest plan from Leadbay data — the accounts worth activating, each with a motif, a pitch and a checklist, ranked by the strongest Leadbay signal. Every figure carries its source, and anything Leadbay can't measure is shown as OMITTED rather than estimated. Uses `leadbay_bulk_qualify_leads` and `leadbay_enrich_titles`. Trigger on \"top 50 accounts to activate\", \"who should we go after\"."
---


## WHAT LEADBAY SHOULD REMEMBER

You keep your own memory of how this user likes to work — tone, naming, formatting, what they ask you to skip. Leadbay does not store that and does not need to.

What Leadbay does need is anything that changes **who it should find**. When the user states targeting criteria in conversation ("I target fleets over 100 vehicles", "carriers are a bad fit unless they do last-mile delivery", "climate engineering is also my market"), call `leadbay_refine_prompt` so it changes what Leadbay surfaces for the whole org and on every future refresh — not just this conversation. When they say a specific lead is wrong for them, record the dislike rather than noting it.


Build me a **top-<the user-supplied value if any; otherwise a sensible default. Source: Optional: how many accounts the plan should hold (default 50).> account-conquest plan** — the accounts worth activating, ranked, each one carrying a strategic motif, a phone pitch and a three-step checklist. <if the user supplied this argument, render the short block derived from it; otherwise empty. Source: Optional: restrict the plan to a territory (e.g. 'Indre-et-Loire', 'Région Ouest'). Sets geography on the Discover lens. A country is not a territory — this workspace already covers exactly one country.>

This deliverable goes in front of a paying client, so **the honesty of the numbers matters more than their completeness**. Deliver the strongest plan the available data actually supports, and be explicit about what it doesn't.

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


GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# Resilience rules for Leadbay long-running tools

These four rules apply to every Leadbay workflow that calls `leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead_by_id`, `leadbay_import_and_qualify`, or `leadbay_enrich_titles`. **Treat timeouts and stream-closed errors as transient, not as signals to replan.**

## Rule 1 — Pin the lens

After your first `leadbay_pull_leads` call, capture `response.lens.id` into your working memory and **pass it explicitly as the `lensId` argument to every subsequent call** in this session — including any re-pulls, bulk qualifies, or research calls that accept it. (Field-name caveat: the response nests it as `lens.id`; the parameter on subsequent calls is `lensId`.) The active lens can shift between calls (5-minute client cache + backend `last_requested_lens` can change if the user touches the web UI). A lens shift mid-workflow throws away your top-10 work.

## Rule 2 — Prefer async for bulk operations

`leadbay_bulk_qualify_leads` and `leadbay_import_and_qualify` accept `wait_for_completion:false`, which returns `{status:'running', notification_id}` immediately. Then poll `leadbay_qualify_status` (or `leadbay_import_status`) every ~10s until the job completes. **Use the async pattern by default** — the blocking default can exceed the MCP client's per-call timeout on large batches and produce a misleading `"Request timed out"` even though the server is still working.

## Rule 3 — Serialize `leadbay_research_lead_by_id` fan-out

`leadbay_research_lead_by_id` is composite and reads many sub-resources. Calling it on 10 leads in parallel can saturate the transport and produce `"Tool permission stream closed"` errors that look like permission failures but are really backpressure. **Call it sequentially**, or at most 3 in parallel. If one call fails with a stream/timeout error, retry that one call once before moving on; on a second failure, note the lead and continue — do not abandon the remaining leads.

## Rule 4 — Retry, don't replan

If a Leadbay tool returns `"Request timed out"`, `"stream closed"`, or any other transport-level error (distinct from a Leadbay-issued error payload), the work may still be running server-side. Do this in order:

1. For bulk tools — retry with `wait_for_completion:false` and poll the status tool with the returned id. Don't re-pull leads; that can shift the lens.
2. For single-lead tools — retry the same call once. If it still fails, record the lead id and continue with the rest of the workflow.
3. **Do not** switch strategies (e.g. "the endpoint is broken, let me re-pull from scratch"). The earlier work is still valid; the timeout was the wire.

If `pull_leads` itself fails and you have no prior batch, then yes — retry it, explicitly pass the lensId you captured (if any), and continue.


# PHASE 0 — SCOPE + STATE

Call `leadbay_account_status` for my quota and active lens.

**What this plan is, and what it deliberately isn't.** Leadbay knows who a company is, how it scores, what signals it has and who to call there. It does **not** know what any account buys from me — invoicing lives in my ERP, and no Leadbay tool exposes it. So this is a **conquest plan**: real accounts, real qualification, real signals, real contacts, ranked by the strongest Leadbay signal available. Revenue-realized, per-family revenue, addressable spend and cash-to-capture are **OMITTED — never estimated, never proxied from headcount, sector or lead score.**

Say that scope in one line up front, so nobody reads the ranking as a money sort. If I ask for a cash-ranked plan, tell me plainly that it needs my invoicing extract and that the MCP has no path to it today — then deliver this plan anyway rather than stopping.

**DELIVER FIRST, ASK ALONGSIDE — never gate the plan on a missing input.** Only TWO things can stop you before you have shipped a ranked list of real accounts: not knowing **whose** plan this is (a company-identity mismatch you genuinely cannot resolve), and a `territory` naming a country that is NOT this workspace's own — or a supra-national scope (see the country branch below, which overrides this rule for that one case). The second is an exception for the same reason as the first: both would ship a plan about the wrong companies. Delivering a whole-workspace plan under a "France" heading is not a partial answer, it is a wrong one. Everything else is a question you carry *next to* the delivered plan, not a reason to withhold it:

- **No benchmark?** Costs nothing here — the money column is OMITTED regardless. Pull, qualify, rank by the Leadbay signal, deliver, and mention what a cash-ranked version would need.
- **No Tier-1 threshold?** Not a blocker. Deliver, and ask alongside.
- **No territory?** Not a blocker — but do NOT call the result "national". You'll be pulling my ACTIVE lens, which may already be scoped to a city, sector or rep patch. Say the plan covers **my active lens's existing scope** (name the lens), not the whole country, and offer to re-scope. Calling a city-scoped lens a national plan misdescribes the deliverable to a client.
- **`last_requested_lens: null`?** Not a blocker — and **do NOT read it as "no lens exists".** `leadbay_account_status` deliberately WITHHOLDS the lens id unless the request mentioned the lens/audience, so a plain "top 50 accounts to activate" returns null even when I have a perfectly good active lens. Default to calling `leadbay_pull_leads` with **no** `lensId` and let it resolve my active lens; capture `response.lens.id` from that result and pin it thereafter. Only create or switch a lens when I explicitly asked to scope or change the audience (e.g. a `territory` argument) — inventing a new lens silently changes what I see in the product.
- **Only 3 qualification questions instead of 5?** Not a blocker. Use the org's real questions, note the gap, recommend the additions — do not wait for permission before pulling.

Bundling a non-blocking question in with a blocking one turns a justified pause into an over-wide gate, and the user gets a plan-of-a-plan instead of a plan. The test is **"have I shipped a ranked list of real accounts yet?"** — if you're about to end a turn without one, you are almost certainly over-gating: deliver first, then ask.

If I gave a `territory`, scope discovery to it now, and **make sure the scoping actually took effect before you pull** — a territory request that silently returns out-of-territory accounts is worse than none.

- **Preferred: `leadbay_adjust_audience`** on my active lens, passing the place as `locations`. It applies directly, so the lens I already use is now scoped and `leadbay_pull_leads` needs no new id.

  ⚠ **Location criteria MERGE — they do not replace.** `adjust_audience` unions the new `location_ids` into any existing include-location criterion (and `pull_followups` merges its `city` shortcut the same way). So asking for "Région Ouest" on a lens already scoped to Paris yields **Paris OR Région Ouest** while your header claims Région Ouest. Before adding a territory, check the current filter: if it already carries locations you were not asked to keep, clear or replace them (or build a fresh territory-only lens for this one-off plan) rather than stacking a union.
- **If a new lens is genuinely warranted: `leadbay_new_lens` is a two-step call.** It returns `status:"preview"` and creates NOTHING unless you re-call the same args with `confirm:true`. So: preview → confirm → take `lens.id` from the `created` response → pass that id as `lensId` on every subsequent pull. Never continue on the previous active lens after previewing a new one; that delivers the old audience under a new heading.

If the `territory` I named is a country, which one decides what you do:

- **This workspace's own country** → make no scope CHANGE, but do not claim national
  coverage until you have READ the lens. `leadbay_pull_leads` keeps applying my ACTIVE
  lens, and this prompt already warns that lens may be scoped to a city, a sector or a
  rep patch. On an FR tenant whose active lens is Paris-only, a `territory: "France"`
  plan is a Paris plan — and "covers all of France" printed above it is exactly the
  confidently wrong deliverable this whole gate exists to stop, this time in my own
  header rather than in a filter.
  **Read the `lens://<id>/definition` resource** — that is the only place a lens's
  `location_ids` are visible. `leadbay_pull_leads` returns only `lens: {id}`, not the
  filter, and `active_filters` describes the separately-persisted MONITOR filter, not
  the Discover lens; neither can settle this and neither is a substitute (same rule as
  the Monitor-mirroring section below). Then say ONE of: the lens really is
  workspace-wide, or it is scoped to `<the places its filter names>` — offering to clear
  that scope if national is what I meant. If you genuinely cannot read the definition,
  say the scope is unverified rather than calling it national. Then offer sector / size
  / sub-country region as the axes that would actually narrow it.
- **A different country, or a supra-national scope** → do NOT simply drop the scope and build the plan anyway. An unfiltered plan is this workspace's own accounts, which is not an answer to a request about somewhere else — delivering it under my heading would be a confidently wrong plan. Say the ask cannot be filled from this workspace and stop. **This is the one case that overrides DELIVER FIRST above**: shipping the plan anyway is the failure, not the fix.

**One workspace = one country — a country name is NEVER a location filter.** The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro*: the call is silently fenced to one village and every conclusion from it is wrong. City AND country named? Keep the city, drop the country.

**On `code: "COUNTRY_LEVEL_LOCATION"` read `country_locations[].axis` and `[].kind` — the recovery differs per case and they are NOT interchangeable, and do NOT retry with another spelling or a nearby city.**

`axis: "include"`:

- `home_country`, or "nationwide" / "everywhere" → drop that ONE value. Omit the geo argument (`city` / `locations` / `location_ids`) only if nothing else was on it — then the result covers the whole workspace. If other values remain, keep them and describe the result as those places.
- `foreign_country` ("leads in France" on a US workspace) → **unsupported, not unfiltered.** Do NOT re-run without the argument: whole-workspace results are US leads and answer nothing about France. Say the workspace holds only its own country's companies.
- `supranational` ("EU", "EMEA") → name what the workspace covers, then offer the whole-workspace view as an explicit choice rather than assuming it.
- `country_indeterminate` (custom/staging backend) → its country is unknown, so claim nothing about what it holds.

`axis: "exclude"` reverses all of that — **never "omit the argument"**, which returns the very companies the user asked to remove. Excluding this workspace's own country would empty it; excluding any other country is a harmless no-op. Either way drop the value and ask what to carve out instead.

On a lens-WRITING tool (`new_lens`, `adjust_audience`, `update_lens_filter`) write NOTHING, with no re-call in any form: when the country was the only scope; for ANY `foreign_country` or `supranational` INCLUDE however much else came with it — the sectors and sizes were QUALIFYING that territory, not a second request, so writing them alone saves a real audience for a territory nobody asked about; and for ANY non-`foreign_country` `exclude` hit, likewise — dropping it and writing the rest inverts the ask.

**Never infer WHICH country this workspace serves from the user's wording** — "the whole US" does not make it one. Read `_meta.region` on any tool result — it outranks any recalled memory; on `custom`, claim nothing.

Place names never go in `keywords`, `sectors` or `refine_prompt` — text matches, not geo filters.


# PHASE 1 — THE FIVE QUALIFICATION QUESTIONS

Call `leadbay_get_qualification_questions` and use the org's **actual** questions — they become the qualification row on every card. Do NOT invent them.

If the org has none set, or they don't discriminate for this exercise, recommend this shape and offer to set it via `leadbay_set_qualification_questions` (max 5, and ask before replacing anything): **Q1** exercises a core-target trade · **Q2** big enough to matter · **Q3** operates in the covered territory · **Q4** recent activity signals · **Q5** likely need in the next quarter. Q4 and Q5 are the load-bearing pair — they separate "fits the profile" from "worth calling this week". Recommend; don't overwrite without my say-so.

# PHASE 2 — THE ACCOUNT UNIVERSE

⚠ **Monitor membership is not client status.** Monitor tells you what Leadbay is watching — lens scoring decides who lands there, not whether the company ever bought anything. Label that pane "Leadbay view membership", never "customer".

**Get the accounts.** `leadbay_pull_followups` for the known/identified side, `leadbay_pull_leads` for the not-yet-identified side.

⚠ **Monitor's scope must match the scope you put in the header — never leave it accidental.** `leadbay_pull_followups` defaults to applying whatever Monitor filter is persisted server-side from a previous session, and that filter has nothing to do with the lens Discover is using. Two stale-state traps, one rule:

- **A persisted filter you didn't ask for** silently shrinks the known side, so a rep who once filtered Monitor to a city gets a "whole base" plan missing most of it.
- **Blindly passing `filtered:false`** does the opposite: Monitor goes org-wide while Discover stays on a scoped lens, so out-of-scope known accounts land in a plan headed with the lens's name.

⚠ **You cannot mirror a geography you haven't read.** `leadbay_pull_leads` returns only `lens: {id}` — not the lens's filter — so capturing the id tells you nothing about which locations it covers. Before scoping Monitor to match a lens, read the **`lens://<id>/definition` resource** — that is where the filter and its `location_ids` actually live. `leadbay_my_lenses` returns only id / name / description / active flags, so it cannot tell you a lens's geography and must not be used for this. If you cannot determine the lens's geography, do NOT guess: pull Monitor org-wide with `filtered:false` and say in the header that the known side is org-wide while Discover follows lens `<id>`, whose scope you could not read. An unstated mismatch is the failure; a stated one is honest.

So: **read the persisted filter first** (the response reports `active_filters`), then make it match the plan's declared scope. If the plan is scoped (a `territory`, or an active lens with its own geography), apply that same geography to Monitor. If the plan is genuinely org-wide, pass `filtered:false`. Either way, state the known side's scope in the header in the same breath as the Discover side — a plan whose two halves are scoped differently is misleading even when both halves are individually correct.

⚠ **A territory must scope BOTH sides.** Adjusting or creating a lens only scopes Discover; Monitor is filtered through its own path, so pass the territory to `leadbay_pull_followups` as well (its `city` free-text shortcut resolves to a `location_ids` filter, same resolver as the lens). Otherwise a territory-scoped plan quietly mixes in out-of-territory known accounts — and a client reading "Région Ouest" at the top will not check every row. Unless I named a `territory`, call `leadbay_pull_leads` with **no `lensId`** so it resolves my active lens — do not create a lens just because `account_status` showed a null. Capture `response.lens.id` from the first pull and pass it as an explicit `lensId` on every later call — a mid-session lens shift discards the cohort. Keep pulling until you have a pool comfortably deeper than <the count_or_default (as extracted above)>, topping up with `leadbay_bulk_qualify_leads` → `leadbay_qualify_status` → re-pull as needed.

# PHASE 3 — QUALIFY, SIGNAL, MOTIF

**Qualify — the SELECTED cohort, in chunks of 25.** `leadbay_bulk_qualify_leads` caps `count` at **25**, so a single call cannot cover a 50-account plan. Loop until the whole cohort is qualified, polling `leadbay_qualify_status` between chunks.

⚠ **Never qualify Monitor rows through a Discover `lensId`.** `leadbay_qualify_status` re-checks each lead against the lens it was launched on and returns them under **`not_in_lens`** — the backend does not qualify them, so those rows ship with permanently empty pills while the poll reads "still running". So split the cohort: qualify the Discover rows with the pinned `lensId`, and for known-side rows use the qualification data `leadbay_pull_followups` already returned rather than re-launching them off-lens. If a Monitor row has no qualification data, say so in its cell — do not leave a pill that will never fill. **Always read `not_in_lens` in the poll response** and report anything listed there rather than waiting on it.

⚠ **Pass explicit `leadIds` whenever the cohort isn't simply "the next N on the lens"** — e.g. after you've selected a shortlist, or when the plan mixes Monitor and Discover rows. The `count`-based path selects the next *unqualified leads from the lens wishlist*, so on any other cohort it qualifies unrelated leads and hands you handles whose pills belong to different companies. Use `leadbay_bulk_qualify_leads({leadIds:[…≤25 of the cohort], wait_for_completion:false})` and chunk through the cohort's own ids. The `{lensId, count}` form is only right when the cohort genuinely *is* the lens's top N.

**Qualify the plan cohort, not the whole base.** Select your ~<the count_or_default (as extracted above)> candidates (plus a modest buffer for drop-outs) BEFORE qualifying — qualification is async and quota-bearing, so running it across an entire portfolio to produce a top-<the count_or_default (as extracted above)> burns the user's quota for rows that will never appear. **Keep every returned `notification_id`** — the deck's live qualification layer is wired from those handles, and a deck with none is a dead deck that still looks finished. Never ship a plan whose lower ranks have empty qualification pills because only the first 25 were ever qualified.

**Signals — scoped to the cohort.** ⚠ **Always pass the selected `leadIds`.** With `leadIds` omitted, `leadbay_scan_portfolio_signals` builds its own portfolio by paging `/monitor` — so on an imported cohort or a freshly-pulled Discover set it would scan a *different population* and you'd render dashes for accounts whose signals were never read.

`leadbay_scan_portfolio_signals` is also a **filtered** read: it requires a concrete `query` and returns only the accounts whose cached signals match it. It is not a generic "read every signal" call. So run it **once per why-now theme, as SEPARATE calls** — expansion/new site · contract or tender won · funding · hiring · acquisition · new venue — and union the results.

⚠ **One comma-joined omnibus query is NOT six themed scans.** Cramming every keyword into a single string is one match attempt whose recall you cannot inspect: a lead that would have matched "hiring" alone can be missed, and you have no way to tell which themes actually returned anything. Six calls, six result sets, one union. If a theme returns nothing, that is information — record it rather than hiding it inside a broad string. An account that matched no query has **not** been shown to be signal-free; render it with an explicit `—`, never an invented event. For the identified side, take interaction recency from the fields `leadbay_pull_followups` already returned. ⚠ **Do NOT reach for `leadbay_account_history` on Monitor rows outside the active lens** — it calls `research_lead_by_id` first, which fetches `/lenses/{lensId}/leads/{leadId}` and 404s off-lens, so the very rows that need a SUIVI / RÉVEIL-LB decision are the ones it fails on. Use it only for a lead you know is in the pinned lens.

**SIGNAL HONESTY — never infer signals from freshness.** `stale_at`,
`web_fetch_in_progress`, `fetch_at` are freshness markers, not signal
indicators — signal presence is read ONLY from the actual `signals[]` /
`web_fetch.content` entries. For "which of my leads have signal X" across a
portfolio, call **`leadbay_scan_portfolio_signals`** (bulk-reads cached
signals); don't loop `leadbay_research_lead_by_id` per lead or guess from
freshness. A lead with no cached content is `not_researched`, not "no match";
never report a signal verdict for a lead you never read.


**Assign the motif.**

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
the split is simply: in the Leadbay known pipeline → **SUIVI**; not in the
pipeline → **CONQUÊTE**. Never reach for a Pilotage motif you cannot evidence,
and never invent a seventh label — the set is closed at six.

When a known-pipeline row has long-dormant *Leadbay* activity, it stays
**SUIVI** and you say what the dormancy measures in its why-now cell: "no
Leadbay-logged action in N months". That is a qualifier on the evidence, not a
new motif. It is NOT RÉVEIL — RÉVEIL means dormant *purchasing*, which needs
order history you do not have.

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

**The Monitor gap — read this before assigning anything.** Four of the six
motifs (SAUVETAGE / PLAN DE COMPTE / MONTÉE EN GAMME / RÉVEIL) are purchase-
behaviour reads, and CONQUÊTE means "not in the known pipeline". A Monitor row
that is *actively* worked therefore matches none of them: it IS in the pipeline,
and without order history you cannot tell whether it buys broadly, narrowly, or
at all. Do NOT resolve that by guessing a purchase motif, and do NOT silently
drop the row.

Those rows take **SUIVI** (row 6 of the table above). Say in the plan's legend
that SUIVI exists precisely because purchase history is unavailable, and that
ERP order data would split those rows into the four Pilotage motifs.

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
2. **Leadbay-activity recency is a qualifier, never a motif.** A long-dormant
   known row stays **SUIVI** with "no Leadbay-logged action in N months" in its
   why-now cell — never "no orders in N months", and never a seventh label.
   Logged activity is not invoicing.


# PHASE 4 — POTENTIAL AND RANKING

Rank by `ai_agent_lead_score`, then qualification boost, then headcount. **Name that key in the plan's own header** — a reader who assumes a money-sort misreads the whole order — and title the deliverable for what it is (a conquest plan), not for what it isn't.

Cash-to-capture is not available: it needs `ca12` from my invoicing system, which no Leadbay tool exposes. Show it as OMITTED in the ledger and say what a cash-ranked version would require (12-month revenue per account, per-family split, last order date, order count, plus a €/employee benchmark) — do not model it.

# PHASE 5 — CONTACTS (consent-gated)

Each card needs a reachable decision-maker. `leadbay_enrich_titles({leadIds, lensId})` in discovery mode first — that reveals what's enrichable and spends nothing. Render whatever contact detail is already on the record; many accounts already carry a named contact.

**Do NOT stop and wait for enrichment consent before delivering.** Asking for a plan is not authorization to spend quota on <the count_or_default (as extracted above)> accounts — but neither is it a reason to end the turn on a spending question with no plan attached. Ship the ranked plan (Phase 6), then **offer** the paid reveal alongside it. The discovery call returned no `titles`, so it only told you what's *available* — **the offer must therefore carry the titles you propose to enrich AND the channels**, not just a volume: "enrich N contacts at these titles (`<the titles you picked from available_titles / title_suggestions>`), email only / email + phone — reveals consume quota". A bare "yes" to a volume-only question is not a mandate to pick titles yourself, and re-running discovery instead of launching wastes a turn.

⚠ **Do NOT quote a cost or a credits figure.** The per-reveal rate is backend-side and enrichment is gated by quota, not a credit balance; `credits_remaining` is advisory context only. A spend number invented to make the offer concrete is the same failure as an invented euro on a card.

On an explicit yes, launch with the agreed `titles` + channels, then poll `leadbay_bulk_enrich_status` until done and **keep the `notification_id` handles** for the deck.

⚠ **Render only the channels that actually came back.** The default reveal is email-only unless phone was explicitly requested, so never emit a `tel:` link for a contact whose phone was never revealed — show the channels enrichment returned and mark the rest omitted. A fabricated phone link is the same failure as a fabricated euro.

# PHASE 6 — DELIVER

Render the PROVENANCE LEDGER and its legend FIRST, then the chat answer beneath it — never the other way round. A ranked money column read before its sourcing has already misled the reader:

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

**The chat answer must be the whole deliverable the user asked for** — the deck
is optional, so a top-50 request whose chat half stops at 10 rows has delivered
a fifth of the plan. Render the **requested count**, with its pitch + checklist
block per row (see below).

If that is genuinely too long for one message, do NOT silently truncate: state
the delivered count plainly ("here are 20 of the 50 — say the word for the
rest"), so the user knows what they have. Never present a partial list as
though it were the plan. Four columns:

Col 3's header is **the ranking key you actually used** — never a cash label,
since cash-to-capture cannot be computed from Leadbay data:

```
| # · Account | Motif | Fit score | Why now |
```

- **Col 1** — rank number, then the company name linked to its website when one
  is known. Follow with a compact ` · `-separated pill line: city · headcount ·
  any account reference you were given. **Every figure in that pill line carries
  its class too** — headcount is `[LB]` (a Leadbay size band, so render the band
  rather than a false-precision point value) or `[SIRENE]` if you read it from
  the registry. An untagged employee count is still an untagged number in front
  of a client; omit it rather than ship it bare.
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
cannot live only there. Under the table, render a block for **every account you
put in the table** — if a row is good enough to rank, it is good enough to carry
its pitch. Do NOT ship the top 5 or 10 and offer the rest "on request": that
puts the actionable half of the deliverable behind another user turn, and the
rows you defer are the ones a rep is least likely to chase. If the full plan is
genuinely long, shrink the TABLE (fewer rows, stated plainly) rather than
shipping ranked rows with no pitch:

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
- **Qualification row** — the org's **actual** questions as returned by
  `leadbay_get_qualification_questions` (there may be fewer than five), each with
  ✓ / ✗ / pending and labelled with its real text. Render exactly as many rows as
  the org has: never pad to five with invented labels or bogus pending pills, and
  never substitute invented wording.
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
plan, count qualified, count with a reachable contact. **No euro totals** — the
same rule as the table, for the same reason.

⚠ **No "activated" KPI at build time.** Nothing in this workflow measures
activation — the deck is built before any outreach happens — so a count would be
fabricated or imply outcome tracking that doesn't exist. If the deck's checklists
persist locally, an "activated" tile may count *checked* accounts and must be
labelled as local checklist state, not a measured outcome.


Then **offer** the interactive deck — don't force it:

## GATE — PREFER BUILT-IN HOST WIDGETS

Modern chat hosts (Claude, ChatGPT) expose first-party widgets the agent can route into. These ALWAYS produce a better UX than markdown tables / inline prose for the data shapes they support — they're tappable on mobile, persistent across turns, and integrate with the host's quick-actions.

**The Big Three** — when a tool result fits, route there:

| Host widget | Use when | Field map (from Leadbay payload) |
|---|---|---|
| `places_map_display_v0` + `places_search` (Claude) | ≥2 leads with coords / `location.city`, geographic / "in person" / travel intent | **Two-step**: `places_search` each lead (query = company + full street address) → real `place_id`/coords, THEN render with `places_map_display_v0` (Itinerary mode for a tour). Skipping `places_search` → schematic scatter, not a street map. |
| `message_compose_v1` (Claude) | You're about to draft outreach (email / message / call opener) | `{kind: "email", summary_title, variants: [{label, body, subject}]}` — 2–3 variants, labels describe STRATEGY ("Push for alignment", "Reference the M&A signal"), not tone ("Friendly", "Formal") |
| `ask_user_input_v0` (Claude chat / ChatGPT) **or** `AskUserQuestion` (Claude cowork / Claude Code) — whichever is in your tool set; their schemas differ, match the one you have | The tool's NEXT STEPS block has 2–4 mutually-exclusive next moves and the user hasn't already chosen | Per-tool schema in the server instructions + NEXT STEPS routing block. Max 3 questions. |

ChatGPT exposes the same routing pattern via `_meta.openai/outputTemplate`. We don't ship any custom widgets ourselves — this gate is exclusively about routing into the host's first-party widgets when the data shape fits.

**Rules:**
- The widget IS the visual. Do NOT emit a markdown table or prose list of the same data alongside — that produces two competing UIs.
- Pass identifiers (place_id, lead.id, contact_id) verbatim. Don't rewrite.
- When the host doesn't expose the named widget, the agent falls back to the prose/table rendering the per-tool description already specifies. The directive is host-conditional; the fallback is automatic.
- One short intro sentence in chat is enough — "Here are your 5 NYC follow-ups." Then route into the widget.


⚠ **The deck's contact layer depends on what actually happened in Phase 5.** Bind a `leadbay_bulk_enrich_status` resource ONLY if a paid reveal was launched and you hold a `notification_id`. If the user accepted the deck but not the reveal, render the contacts already on record and carry the paid-reveal offer inside the deck — never wire a status resource with no handle (it renders permanently empty) and never launch enrichment from the deck to manufacture one.

On acceptance, call `leadbay_artifact_kit`, read its `usage_guide` before writing any code, and build a single-file deck. Wire the live layer from the handles you kept: a poll-until-done resource per `notification_id` for the qualification pills, and one over `leadbay_bulk_enrich_status` for the contacts. ⚠ **If enrichment already ran this session, bind the existing `notification_id` — re-launching enrichment from the deck double-spends my quota.** Per-card notes and outcomes go through the pre-wired note/outreach view-models (they carry the required verification and `_triggered_by` fields; hand-rolling those is where it breaks). Keep the checklists in local storage, and always wire a Refresh — auto-poll is host-dependent. List every tool the deck calls in its `mcp_tools`, and render the bridge-unavailable branch, or the pills silently show empty.

# Iron laws

- **Never invent a number.** No revenue figure, registry count, signal or lead id that didn't come from a Leadbay response or a real registry query. A modelled figure is fine — tagged `[HYP]` and named as an assumption. An untagged one is not.
- **The ledger ships before the deliverable**, with un-sourceable fields shown as OMITTED rather than dropped.
- **A conquest plan is the deliverable, not a consolation prize.** Leadbay holds no invoicing data, so the money columns are OMITTED by design. Title it honestly, name what a cash-ranked version would need — never refuse, and never fill the gap with a guess.
- **Deliver first, ask alongside.** Do not end a turn without a ranked list of real accounts. The benchmark, the Tier-1 threshold, the territory, a missing lens, a short question set and an unanswered enrichment offer are all NON-blocking — carry them next to the plan. Only an unresolvable identity mismatch (whose plan is this?) may stop delivery.
- **One motif per account, from the closed set of six**, with its deciding evidence stated.
- **The org's real qualification questions**, read from Leadbay — never invented.
- **Consent before any paid enrichment**, and never re-launch a bulk that already exists.
- **Offer the deck; don't force it.** The chat answer must stand alone as useful.
- Carry the captured `lensId` on the calls whose schema **accepts** it (`leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`). Do NOT add it to `leadbay_pull_followups`, `leadbay_scan_portfolio_signals`, `leadbay_qualify_status` or `leadbay_bulk_enrich_status` — they declare no such argument and reject unknown properties.
- Building a plan is not outreaching — do not send anything and do not call `leadbay_report_outreach`.
