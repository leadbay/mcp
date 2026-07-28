# MCP-first lead delivery — personas, use cases, naming

> Product design for exposing the backend MCP-first endpoints
> (`POST /1.6/mcp/search`, `POST /1.6/mcp/qualify`, `GET /1.6/mcp/jobs/{id}`)
> as first-class MCP tools. Grounded in live staging probes against the five
> test accounts (2026-07-28, `.context/probe/` in the working branch).

## The two capabilities, in user vocabulary

| Capability | User sentence | Backend |
|---|---|---|
| **Find new leads** | "Get me 10 *new* companies that look like my ideal customer — qualified, with the right contact and their email." | `POST /mcp/search` → job |
| **Qualify known leads** | "Here are companies I already have — tell me which fit, why, and who to talk to." | `POST /mcp/qualify` → job |

Both answer in one ask what previously took a chain (pull → select → web-fetch →
poll → enrich → poll), and both are **jobs**: submit returns in <1s, results
stream per-item and are collected by polling.

Free tier: `qualify: false, channels: []` costs **0** and still returns company
+ fit score + cached research + contact identity. Paid capabilities (fresh AI
qualification ~94c/candidate examined, email 25c / phone 250c on success) are
opt-in flags with a `dry_run` forecast and a `max_cost` cap.

## Personas

### P1 — Territory rep, physical product (SnapLock: modular floor tiles → gyms/warehouses, US)
Field seller with a geographic patch; prospecting happens between site visits,
often from the phone. Thinks in places and building types, not in "ICPs".

- **Asks**: "Find me 10 gyms around Dallas that would buy our flooring, with
  someone I can call." · "Any new warehouses opening in my patch?" · "I'm in
  Houston Thursday — who's worth a cold visit?" (routes to followups/tour for
  known leads, *search* for net-new).
- **Scheduled**: Monday 7am — "5 fresh gym/warehouse leads in my territory with
  phone numbers" → call sheet in chat.
- **Artifacts**: printable call sheet; map of new prospects + follow-ups.
- **Params profile**: `example_lead` (a fictional typical gym), `filters.locations`,
  `contact_titles: [Owner, Facilities Manager, General Manager]`,
  `channels: [phone]`, small `count` (5-10).
- **Happy**: every delivered lead is *actually a gym/warehouse* (not a flooring
  vendor), has a name + phone, and the one-line "why it fits".
- **Unhappy**: paying for exploration that delivers 0 (probe: naive query
  "gyms in Texas that need durable flooring" spent 165c, delivered 0 — the
  pre-screen rejected 30+ vendor-lookalikes). **The seed discipline exists to
  prevent exactly this.**

### P2 — SDR / outbound at a SaaS scale-up (Rippling: HR/payroll → US SaaS 50-2000 emp)
Quota-carrying, volume-oriented, lives in sequences. Needs precise slices and
verified emails; tolerates cost, not junk.

- **Asks**: "20 new US SaaS companies, 50-2000 employees, that look like
  <best-customer>, with the VP People's email." · "Same as last week but exclude
  everything you already gave me."
- **Scheduled**: daily 8am — top-up batch of N with emails, deduped against all
  prior deliveries (`novelty: org` does this server-side; `exclude_lead_ids`
  belt on top).
- **Artifacts**: CSV for the sequencer; outreach drafts per lead
  (`message_compose_v1` downstream).
- **Params profile**: `example_lead` + `filters.employees_min/max`,
  `qualify: true`, `contact_titles` + `title_gate: strict`, `channels: [email]`,
  `request_id` per day (idempotent re-runs), `max_cost` set consciously.
- **Happy**: n delivered = n asked, each with verified email of the right title.
- **Unhappy**: silent spend; duplicates of companies already in their sequencer;
  title matched to a wrong person. (`title_gate: strict` + funnel honesty are
  the levers.)

### P3 — Merchant-acquisition rep (DoorDash: restaurants, city by city)
Works dense local markets; the "list" often comes from walking around, maps, or
a city scrape. Net-new discovery matters less than **vetting a known list fast**.

- **Asks**: "Here are 60 restaurants from my Austin sweep — which are open,
  independent, and not already on the platform? Who's the owner?" · "Qualify
  yesterday's delivery and get phone numbers for the top ones."
- **Scheduled**: weekly re-vet of the working list (`prior_deliveries` selector
  re-reads past outputs at near-zero cost thanks to caching).
- **Artifacts**: door-knock route (map widget), call sheet with owner + phone.
- **Params profile**: `lead_refs` by website/name+location, `contact_titles:
  [Owner, General Manager]`, `channels: [phone]`.
- **Happy**: per-item verdicts — even "not in our universe" is an answer that
  saves a visit. Disqualified leads come back *with the negative evidence*.
- **Unhappy**: whole-job failure because one ref was junk (backend guarantees
  per-item outcomes — probe: 3 `not_in_universe` + 1 `low_confidence_identity`,
  job still `completed`, cost 0).

### P4 — Sales manager / team lead
Feeds the team, owns spend, coaches with evidence. Runs org-level intelligence
(qualification questions, IBP) and expects deliveries to obey it.

- **Asks**: "Get each of my 3 reps 10 fresh leads in their region for Monday."
  · "Re-qualify the 200 stale leads in our pipeline against the new
  qualification questions — who should we drop?" · "What did that search cost?"
- **Scheduled**: Sunday night per-territory batches (one job per territory,
  `request_id` = week+territory so retries never double-spend); monthly
  pipeline re-vet via `qualify` (cache makes repeats cheap).
- **Artifacts**: per-rep briefs; a funnel/cost report ("38 matched, 9 examined,
  3 delivered, €6.09 — stopped at your cost cap").
- **Happy**: predictable spend (`dry_run` forecast, `max_cost`), auditable
  funnel, deliveries that respect the org's questions/tags/IBP snapshot.
- **Unhappy**: a rep burning the org's monthly budget in an afternoon (plan-tier
  default caps + explicit `max_cost` are the guardrails; the agent must state
  costs *before* paid runs).

### P5 — Founder-led sales, FR SMB (Sol Mur: revêtements; Home Spirit: mobilier B2B)
Non-technical, prospecting in bursts between deliveries; speaks French to the
agent; the SIRENE-based FR universe is their world.

- **Asks**: "Trouve-moi 5 hôtels ou promoteurs en Île-de-France qui rénovent
  leurs espaces, avec un contact achats." · "Qualifie ces 12 entreprises de mon
  fichier Excel."
- **Scheduled**: rare — prefers on-demand bursts.
- **Artifacts**: a short brief per lead, in French (`lang: fr`), ready to turn
  into a call.
- **Params profile**: French `example_lead` description (FR bridges text seeds
  into the SIRENE embedding space via exemplar expansion — the seed style rules
  apply identically), `lang: "fr"`.
- **Happy**: results in French, sectors that make sense in the French taxonomy.
- **Unhappy**: anglocentric outputs; sector labels that don't resolve (submit
  400s name the offending value — the agent should fix and retry, or use
  `leadbay_list_sectors`).

### P6 — RevOps / data owner
Owns the CRM. Thinks in batches of 500, dedup keys and cost lines, not in
individual leads.

- **Asks**: "Vet this 500-row export: which are ICP-fit? Which have verified
  emails for a Head of Ops?" · "Re-read everything MCP delivered in June."
- **Scheduled**: quarterly hygiene sweep (`qualify` with `lead_refs` ≤500, or
  `prior_deliveries` for the ledger).
- **Artifacts**: enriched CSV back; a delta report (newly disqualified since
  last sweep).
- **Happy**: idempotency (`request_id`), per-item cost lines, cache reuse
  ("repeat calls converge to near-zero cost").
- **Unhappy**: re-buying data it already owns (`already_owned` channel status
  and `from_cache` flags exist precisely for this — surface them).

## Use-case → routing map

| User says | Route to | Why |
|---|---|---|
| "Find me N new companies like X / that do Y" | **find_new_leads** (new) | net-new + custom ICP + one shot |
| "Show me today's leads / my inbox" | `leadbay_pull_leads` | daily lens picks, free, taste-based |
| "More leads like the ones in my lens" | `leadbay_extend_lens` | grows the lens itself |
| "Qualify/vet THESE companies" (ids, websites, CSV rows, prior deliveries) | **qualify_leads** (new) | server-side batch verdicts + contacts |
| "Qualify my top lens leads" | `leadbay_bulk_qualify_leads` → *migration target* | legacy client-side chain; new route covers it via wishlist ids |
| "Get emails/phones for these leads' contacts" | **qualify_leads** with `channels` | enrichment now rides the same job |
| "Research this one company in depth" | `leadbay_research_lead_by_id` | single-lead dossier, richer prose |
| "Who should I follow up with?" | `leadbay_pull_followups` | engaged pipeline, not net-new |
| "Import this file" | `leadbay_import_leads` (+ optionally qualify after) | file wizard owns column mapping |

## What the probes taught us (drives every description/prompt decision)

1. **Seed quality is the product.** Naive NL query → 0/3 delivered, 165c burned
   (vendor-confusion: embedding matches topic *vocabulary*). A fictional
   ideal-customer `example_lead` in registry style is the single highest-leverage
   input. The backend's own scope note says so; our prompt teaches the craft
   (see the fake-leads discipline distilled in the tool description + prompt).
2. **Zero-delivery is a real outcome and must be narrated, not hidden.** The
   funnel (`matched/examined/qualified/disqualified` + `stop_reason` +
   `scope_notes`) tells an honest story the agent must render. "9 examined, 8
   disqualified, stopped at your cost cap" is actionable; "no results" is not.
3. **Cost literacy up-front.** `qualify: true` bills ~94c per *examined*
   candidate (survivor or not). Default `max_cost` (plan tier) can stop a job
   mid-exploration (probe: stop=max_cost at 609c). The agent should `dry_run`
   before the first paid run of a session and state the worst case.
4. **Need-B refs resolve against the known universe.** Off-universe websites
   come back `not_in_universe` per-item (cost 0) — an answer, not an error.
5. **Jobs are minutes-scale.** Submit <1s; free search ~seconds-minutes; paid
   exploration up to 30 min wall-clock. Tools must poll briefly then hand back
   a `job_id` + explicit "check again with …" next step.

## Naming

New tools (all composite):

| Name | Kind | Rationale |
|---|---|---|
| `leadbay_find_new_leads` | read (submit is free by default; paid flags are explicit params) | The user phrase is literally "find me new leads". Distinct from `pull_leads` (today's lens picks) and from granular `discover_leads` (wishlist page relay, advanced-gated). |
| `leadbay_qualify_leads` | write-tier | "Qualify these leads" — plural, arbitrary refs. Sits between granular `qualify_lead` (single, advanced) and legacy `bulk_qualify_leads` (lens top-N chain). |
| `leadbay_lead_job_status` | read | Polls `GET /mcp/jobs/{id}` for both kinds; follows the `*_status` convention (`qualify_status`, `import_status`, `bulk_enrich_status`). |

New prompt: **`leadbay_new_leads`** — the guided "find me new leads" session;
owns the NL-need → seed-description craft (fake-leads discipline), dry-run cost
gate, submit, poll, render, iterate loop.

**Vocabulary rule:** "seed" in this repo already means *existing lens leads
used for extra-refill* (`seed_candidates`, `seed_lead_ids`). The new surface
never says "seed" in tool/param names — the request param is `example_lead`
(backend vocabulary), described as "a fictional ideal-customer example".

## Deprecation direction (not executed in this PR)

| Existing | Status | Path |
|---|---|---|
| `leadbay_bulk_qualify_leads` | **migration target** | New `qualify_leads` is server-side, cached, per-item honest, and bundles contacts. Keep for one release with cross-routing anti-triggers pointing at the new tool; remove after evals confirm parity. |
| `leadbay_enrich_titles` + `bulk_enrich_status` | keep (consent UX) | Channel purchase now also rides search/qualify jobs; the dedicated flow remains for enrich-only asks on selections. Cross-route. |
| `leadbay_qualify_lead`, `leadbay_qualify_status` | keep (advanced/status) | Advanced tier stays near-raw. |
| `leadbay_pull_leads`, `extend_lens`, `seed_candidates` | keep | Different job: daily taste-based lens flow vs on-demand net-new ask. Cross-route both ways. |
| `leadbay_import_and_qualify` | keep, re-route step 2 | Import wizard stays; its qualify step can hand off to `qualify_leads` by lead ids in a follow-up PR. |

## Measurement

`.context/probe/benchmark-*.md` (working branch): same ICP ask executed (a) via
the old chain (pull → select → web-fetch → poll → enrich) and (b) via the new
routes, on staging accounts; wall-clock + spend recorded, output quality judged
by an independent reviewing agent on: ICP fit of delivered leads, contact
correctness, honesty of the failure story, and actionability of the rendering.
