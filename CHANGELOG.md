# Changelog

## 0.35.0 — 2026-09-02 — Background jobs you can come back to

- **A job you start without waiting now hands back Leadbay's own id.**
  Qualification, imports and contact enrichment launched in the background
  return the same id Leadbay keeps for thirty days. Ask about it in the next
  message, the next conversation, or tomorrow, and the assistant picks it up.
  On the hosted assistant those three requests used to fail every time with
  "No BulkTracker configured"; they now work.
- **Nothing of yours is kept on our server between messages.** The assistant
  no longer writes imported rows or lead lists to a file of its own; Leadbay
  is the only record.
- **Old ticket names are answered, not crashed.** An assistant still passing
  `bulk_id`, `qualify_id` or `handle_id` is told which id to pass instead.
- **The wrong kind of id is caught.** An import's id given to the enrichment
  status (or the other way round) is named as such, instead of a confident
  wrong answer.
- **Work you start keeps running, even if you stop the assistant.** An import,
  an enrichment or a qualification cannot be called back once it has started —
  Leadbay finishes it. Stopping the assistant, or a slow reply, only stops the
  waiting. The assistant now knows this and checks on the job instead of
  starting it again, so the same rows are never paid for twice.

## 0.34.0 — 2026-09-02 — Leadbay on ChatGPT gets its own address

- **On ChatGPT, add Leadbay as `https://mcp.leadbay.app/chatgpt/mcp`.** Same
  Leadbay, same sign-in, same leads, same everything — except the assistant
  cannot generate a top-up link or open your billing page there, and will not
  suggest buying credits at all. ChatGPT's rules for apps do not allow an app
  to sell credits or plans, or to push you toward an upgrade. When you run out
  of quota it tells you which window is empty and when it refills. Buy credits
  in your Leadbay account as usual; tell the assistant you did, and it picks
  straight back up where it stopped.
- **Nothing changes on Claude.** `https://mcp.leadbay.app/mcp` keeps the
  30-second top-up and the billing link exactly as before.
- **If ChatGPT was already set up for you**, our installer now points it at the
  new address on its own.

## 0.33.4 — 2026-09-02 — Enrich the one person you named

- **You can now ask for one specific person's email or phone.** "Get me the
  managing director's email, not the president's" used to have no direct
  answer on the hosted assistant: the tool that enriches a single named person
  was only available with an advanced setting nobody hosted turns on. The
  assistant fell back on pinning, which never enriches anyone and failed every
  time. That tool is now available by default, and the assistant is told it is
  the right one when it has already picked who it wants.
- **The pinning error now points at the direct route.** When you try to pin a
  suggested contact who is not yet in your list, the assistant is told it can
  enrich exactly that person, as well as the existing by-title and add-contact
  routes.

## 0.33.3 — 2026-09-02 — Pinning a contact says what it can and cannot do

- **Pinning someone Leadbay only suggested no longer looks like a breakage.**
  You can pin the people already in your contact list. Someone Leadbay has
  suggested for a company but not yet enriched cannot be pinned. The assistant
  used to get back a bare "contact not found", read it as Leadbay being broken,
  and try again several times. It now knows the difference, says so, and tells
  you how to get that person into your list.
- **Pinning does not decide who gets enriched.** Asking for the managing
  director rather than the president is a matter of which job title you ask
  Leadbay to enrich, not which contact you pin. The old wording suggested
  otherwise and the assistant believed it.
- **You can see who is pinned.** Whether a contact is pinned, and whether
  Leadbay pinned them for you rather than you doing it, now comes back with the
  contact instead of having to be inferred.

## 0.33.2 — 2026-09-02 — Correcting a contact no longer wipes their email

- **Fixing one detail on a contact used to delete the others.** Asking the
  assistant to correct someone's job title erased their email and phone,
  silently, and reported success. Now anything you do not change keeps its
  value.
- **Removing a detail on purpose still works, and now takes saying so.** To
  clear an email the assistant states it explicitly, along with the rest of the
  contact. If it does not, the edit is refused instead of deleting things
  nobody mentioned.

## 0.33.1 — 2026-09-02 — A slow import is not a broken one

- **A slow import no longer gets reported as failed.** The recent fix taught the
  assistant to hand back a receipt instead of an error when an import takes a
  while. One case was still wrong: if the import stayed slow for a long time,
  the assistant would eventually call it failed, even though Leadbay was still
  working on it and would have finished. It now keeps saying it's in progress.

## 0.33.0 — 2026-09-01 — Your assistant remembers; Leadbay stops pretending to

- **Leadbay no longer keeps its own notebook about you.** The three
  `leadbay_agent_memory_*` tools and the file behind them are gone. Every
  assistant Leadbay plugs into — Claude chat, Claude Cowork projects, ChatGPT,
  Codex — now remembers your tone, your naming, and how you like to work, on its
  own and across conversations. Ours did the same job worse: it lived on the
  server and was wiped on every release, which is how one customer lost
  fifty-four rules he had taught it over two weeks.
- **What you say about your market now reaches the product.** Telling the
  assistant "I target fleets over a hundred vehicles" or "carriers are a bad fit
  unless they do last-mile" used to be filed as a note that changed one
  conversation. It now goes to your targeting, which changes what Leadbay finds
  for your whole team, in the web app too, on every refresh.
- **Every leads screen answers a little faster.** Nine tools were each making an
  extra round-trip to fetch that notebook before replying. They no longer do.

## 0.32.6 — 2026-09-01 — An honest word when a Leadbay call is refused

- **The assistant stops saying it already retried when it didn't.** When Leadbay
  refuses a call, the assistant explains what happened. For anything that writes
  — adding a top-up, opening billing — it never retries on its own, because
  replaying a write can do the same thing twice. The explanation said otherwise,
  so you were told a second attempt had been made when there had only ever been
  one.
- **Paying is treated as an action, not a lookup.** Creating a top-up link or
  opening the billing portal now asks you first, like any other action that
  changes something.

## 0.32.5 — 2026-09-01 — Editing a contact stops failing

- **Fixing a contact's details now works.** Asking the assistant to correct a
  contact's title, email or LinkedIn used to fail every time. Leadbay keeps two
  kinds of contact — the ones your team added, and the ones bought from an
  enrichment provider — and only the first can be edited. The assistant could
  not tell them apart, so it kept picking the wrong one. It can now, and it
  offers to add a corrected contact when the original is a bought one.

## 0.32.4 — 2026-09-01 — "Your enrichment finished" now reaches hosted users

- **Background work that finishes while you are away is reported again.** If you
  started an enrichment, a qualification or an import and came back later, the
  assistant had no way to know it had finished — it always reported nothing
  waiting. It now reads the same notifications the web app shows you, so your
  morning check-in opens with what completed overnight.
## 0.32.1 — 2026-09-01 — A stalled Leadbay can no longer freeze your session

- **When you cancel, Leadbay actually stops.** Cancelling a tool call — or your
  client giving up on one — used to stop the polling but leave the request
  itself running, still holding one of the five slots the server has. Enough of
  those and everything else queued behind them. Now cancelling closes the
  connection and frees the slot immediately.
- **This is what made a stalled backend a 36-hour outage.** One customer had 28
  calls sit open for up to 57 hours. The connection had been accepted, so
  nothing anywhere reported a problem — she just got silence for a day and a
  half, on the only Leadbay surface she uses.
- **Long jobs are untouched.** Enrichment, bulk qualification and imports launch
  work and poll for it, and they keep their own budgets. Nothing now decides on
  Leadbay's behalf how long its work is allowed to take.
- **Cancelling never loses track of something you already saved.** Only reads
  are dropped mid-flight. A note or an import already on its way to Leadbay is
  allowed to finish, so you are never told it wasn't saved when it was.
- **A last-resort backstop closes a connection nobody is waiting for any more**
  after 10 minutes — longer than the longest job any tool runs — so an orphaned
  request can't hold a slot forever. `LEADBAY_TIMEOUT_MS` changes it; `0` turns
  it off. That variable was already documented; now it works.
- **A timed-out call tells the agent to retry** instead of failing silently, a
  stalled account can no longer distort our own latency numbers, and a timeout
  now raises an alert instead of waiting to be found in a retrospective.
## 0.32.0 — 2026-09-01 — A slow import is no longer a failed import

- **A slow import stops looking broken.** Leadbay's import sometimes takes a
  minute or more. The assistant used to wait sixty seconds, give up, and report
  an error — even though the import was still running perfectly well on our
  side. It now says the import is running and comes back for the result.
- **No more re-uploading the same file.** Because the old answer looked like a
  failure, the assistant would try the whole import again. One customer's file
  went up nine times in eleven minutes on a single request. It now checks
  progress instead of re-importing.
- **You still get your leads.** Checking an import's progress now returns the
  imported leads themselves, so the assistant can qualify them or write to them
  straight away — no second import just to find out which leads it created.
- **Rows that are still being placed are counted as "in progress", never as
  failures.**
- **"Import budget exhausted" is gone.** It was never about money or credits —
  it meant the wait had run out. Nothing bills you for waiting.

## 0.31.1 — 2026-08-28 — Asking for more leads on an empty lens now says no

- **Asking for more leads on a lens that has nothing left no longer looks like
  it worked.** Before, the request came back as "queued" whether or not there
  was anything to add, and the leads simply never arrived. That is what one
  customer's assistant kept doing: 49 requests over three weeks, every one
  reported as accepted, none of them able to deliver.
- **The check now happens before the request is sent.** Leadbay looks at how
  many leads the lens could still take. If the answer is none, the request is
  refused with the reason instead of accepted and quietly dropped.
- **The refusal says which kind of empty it is** — an audience that matches
  nothing at all, or one where everything matching has already been delivered —
  and names the criteria in the way, so the next move is widening the audience
  rather than asking again.
- **A lens that can fill is unaffected**, and now also reports how many leads it
  still has available.

## 0.31.0 — 2026-08-28 — An empty lens tells you why

- **A lens with no leads now says what is wrong with it.** Before, asking for
  leads on a lens whose filters match nothing came back with an empty list and
  no explanation, which looks exactly like a lens that is still loading. So the
  assistant kept trying. One customer's agent asked for more leads 49 times over
  three weeks on lenses that could never fill.
- **The answer now names the criteria in the way, and says to stop retrying.**
  If the geography is pinned to a single town, that town is named first, because
  that is nearly always the thing to widen.
- **"Still loading" and "genuinely empty" are finally different answers.** Only
  the first one asks you to wait.
- **Nothing is guessed.** A lens that is empty for a reason we cannot read says
  so plainly, rather than inventing a cause.

## 0.30.0 — 2026-08-19 — Country-wide means country-wide

- **Asking for leads "anywhere in the US" no longer searches one village.**
  Your Leadbay covers exactly one country, so a whole-country ask now means
  *everything* — no location filter — and the answer says so.
- **Naming your own country used to quietly break the search.** There is no
  "France" or "United States" to filter on, so the search fell through to the
  nearest same-named town: France landed on the commune of Francs, the United
  States on Statesboro. Every answer after that was drawn from one village,
  with nothing on screen to show it. Country names are now refused up front,
  with the reason and the fix.
- **Asking to scope a lens to your own country now gets an explanation**, not a
  silently-broken lens — plus the ways that do narrow an audience: sector,
  company size, or a region, state, county or city. Nothing is saved to say
  something your workspace already is.
- **Asking for a country that isn't yours gets told so**, instead of quietly
  handing back your own country's leads as if they answered. And asking to
  EXCLUDE your own country stops rather than doing the opposite of what you
  asked.
- **The rest of your request survives.** Ask for healthcare companies in your
  country and you get the healthcare lens; name a city alongside the country
  and the city is kept.
- **Regions inside your country still work exactly as before** — Texas,
  Île-de-France, Indre-et-Loire, Guadeloupe, Puerto Rico, and every US state
  by name or two-letter code.

## 0.29.0 — 2026-08-17 — Guided first-run walkthrough

- **New: "Walk me through Leadbay."** A brand-new user now learns Leadbay by
  doing it, not by reading about it. Four steps, one button each: check which
  account you're on, pull today's leads, get a first email drafted to the best
  of them, and find out who to send it to.
- **It writes the first email for you.** Leadbay already worked out why the top
  company fits, so step 3 drafts the opener instead of leaving you at a blank
  page. It drafts only — nothing is ever sent, and you see it first.
- **One way forward per step, on purpose.** A first-run user doesn't yet know
  enough to pick from a menu, so each step offers exactly one next move plus a
  way out. You can always type instead — say anything off-script and the
  walkthrough steps aside.
- **Nothing is spent without your say-so.** Drafting is free, and so is the
  preview of *which* roles you could contact. Revealing an actual email or phone
  number is a separate step that tells you the cost before you decide.
- **An empty first batch is explained, not reported as failure.** A new lens
  takes about a minute to compute its first wishlist; the walkthrough says so and
  offers to re-pull instead of announcing "no leads".
- Available as the `leadbay_getting_started` prompt (and slash command) or via
  the matching tool when you just ask how to get started.

## 0.27.0 — 2026-07-31 — Consent-gated problem reporting

- **`leadbay_report_friction` now asks before it reports.** Previously the agent
  was instructed to fire it silently and never let you know it existed. It now
  only runs when you ask for a problem to be reported — or when you accept an
  offer — and it always tells you the outcome.
- **Your words, not the agent's.** The report is the message you approved. The
  agent-authored free-text field is gone, `tool_called` is restricted to real
  tool names, and the verbatim prompt slice (`_triggered_by`) is no longer
  attached to this tool's analytics.
- **Honest confirmations.** If the report can't be delivered (telemetry off or
  unavailable), the tool says so instead of claiming it reached the team.
- **Venting is not consent.** Frustration alone never triggers a report through
  any tool — the agent keeps solving what you actually asked for, and may offer.
- Registry listing now carries a real icon, and the `@leadbay/mcp` npx pin
  tracks the current version line again.

## 0.26.0 — 2026-07-29 — Autonomous, target-sized `leadbay_build_campaign`

- `leadbay_build_campaign` now runs **end-to-end without pausing** and builds to
  a caller-specified size. Two new optional arguments:
  - `count` — how many fully-actionable leads to build (default 20). The prompt
    keeps discovering, qualifying, enriching, and swapping until that many in-ICP
    leads each have a reachable target-title contact — or the lens is exhausted.
  - `job_titles` — the exact buyer titles to enrich (comma-separated, e.g.
    "VP Sales, Head of Growth, Director of Business Development"). Omit and the
    buyer persona is derived from what the user sells, as before.
- Removed the mandatory enrichment confirm gate and the lens-switch / handoff
  pauses: asking for the campaign IS the authorization. The only early stops are
  lens exhaustion or a backend 429 (quota). Enrichment is still quota-gated and is
  never refused on a "credits" balance.
- A lead counts toward the target only once its target-title contact actually
  landed (email/phone present); empty enrichments are swapped out and refilled.

## 0.23.0 — 2026-06-21 — Build-a-campaign guided flow

- Added the `leadbay_build_campaign` prompt (and auto-generated Claude skill):
  one guided on-ramp that takes a solo user from intent to a ready-to-work
  campaign — discover on the active lens → qualify → pick an ICP candidate pool
  → enrich the people who would actually BUY the user's product → persist via
  `leadbay_create_campaign` → render the `leadbay_campaign_call_sheet` view,
  then hand off to `leadbay_work_campaign`.
- Enrichment is **buyer-persona-driven, not seniority-driven**: Phase 3 derives
  who buys the user's product from their ICP (a sales tool → the revenue org),
  filters `recall_ordered_titles` / discovery suggestions to that persona, and
  refuses ops/finance/IT-by-seniority. Confirms persona + spend before launching.
- **Coverage guarantee**: drops/swaps any lead with no enrichable buyer-persona
  contact for the highest-score in-ICP lead that has one — never trading ICP fit
  for coverage. Final cohort is all buyer-ready.
- **Suspect-contact flag**: marks ⚠ any enriched email whose domain ≠ the
  company, or any contact appearing on >1 lead, so the rep doesn't email a
  mis-attributed address. Polls enrichment to completion before rendering.
- Pure orchestration of existing composites — no new tool or endpoint.
- Added eval workflow #34 (multi-turn) in `WORKFLOWS.md`. Tuned over 4 live
  eval cycles against the test account (campaign quality 3/7 → 11/11 leads with
  a real revenue buyer reachable).

## 0.13.0 — 2026-05-21 — Agent memory v1

- Added local-file agent memory for Leadbay MCP: append-only JSONL entries
  under `~/.leadbay/memory/{account_id}/`, consolidated at read time with
  dedupe, confidence decay, validation bonuses, contradiction penalties, and
  tombstones.
- Added always-on `leadbay_agent_memory_recall`,
  `leadbay_agent_memory_capture`, and `leadbay_agent_memory_review` tools.
- Leads-touching tools now attach `_meta.agent_memory.summary` unless
  `LEADBAY_AGENT_MEMORY=off` is set, so agents can apply remembered taste
  signals without an extra recall round trip.
- Promptforge now injects a shared memory pointer into routed tool
  descriptions and a memory preamble into Leadbay workflow prompts.
- Active MCP install/runtime pins are bumped from `@leadbay/mcp@0.12` to
  `@leadbay/mcp@0.13`.

## 0.8.0 — 2026-05-15 — Skills + initialize catalog + daily check-in resilience

Two correlated workflow upgrades shipped together: (1) the six MCP
prompts now also ship as auto-discovered Claude Code skills and the
MCP `initialize` response advertises the catalog so UI-blind clients
(Cowork) learn the prompt set; (2) `leadbay_daily_check_in` gains
resilience rules against MCP per-call timeouts, mid-session lens
shifts, and `leadbay_research_lead` fan-out backpressure — three
failure modes seen in a real session.

### Daily check-in resilience

A live `leadbay_daily_check_in` run failed in three correlated ways — a
blocking `leadbay_bulk_qualify_leads` hit the MCP per-call timeout, the
recovery re-pull silently switched lens and discarded the EU batch, and
ten parallel `leadbay_research_lead` calls produced `"Tool permission
stream closed"` backpressure that the agent treated as terminal. All
three are workflow-contract gaps, not server bugs.

- New reusable snippet `packages/promptforge/snippets/heuristics/long-running-tools.md`
  codifies four resilience rules: pin the captured `lensId` to every
  subsequent call, default `wait_for_completion:false` + `qualify_status`
  polling for bulk ops, serialize `leadbay_research_lead` fan-out
  (≤3 parallel), and retry transient transport errors instead of
  replanning.
- `leadbay_daily_check_in.md.tmpl` includes the snippet, adds a
  `PHASE 0 — RESUME CHECK` so "continue from where you left off" does
  not restart, pins `lensId` in Phase 2, switches Phase 3's top-up to
  the async pattern with `lensId`, and serializes Phase 4. Three new
  `failure_modes` entries enforce the rules during evals.
- Belt-and-suspenders updates to three composite tool descriptions
  (`pull-leads`, `bulk-qualify-leads`, `research-lead`) so ad-hoc tool
  use gets the same hints even without the prompt.

### Prompts ship as Claude Code skills; initialize advertises them

The six MCP prompts (`leadbay_daily_check_in`, `leadbay_research_a_domain`,
`leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`,
`leadbay_refine_audience`) now also ship as auto-discovered Claude Code
skills, and the MCP server's `initialize` response advertises the catalog
to clients (Cowork is the prototypical case) that don't render the
`prompts/list` UI.

### New emit targets in `@leadbay/promptforge`

- `.claude-plugin/plugins/leadbay/skills/<name>/SKILL.md` — one auto-
  discovered skill per prompt. `{{arg:NAME}}` placeholders in the prompt
  body are rewritten in-place as natural-language extraction instructions
  because skills have no structured-argument system. Snippet includes are
  resolved by the existing assembler so iron-laws and gates ship in both
  surfaces from a single source. First occurrence of each placeholder
  gets the full extraction prompt; subsequent occurrences become terse
  back-references so calls like
  `tool({lead_id: '<the lead_id (as extracted above)>'})` stay readable.
- `PROMPT_CATALOG_HEADER` / `PROMPT_CATALOG_BULLETS` /
  `PROMPT_CATALOG_INSTRUCTIONS` exports added to
  `packages/mcp/src/prompts.generated.ts`. The MCP server splices the
  filtered bullets into its `initialize` `instructions` payload via
  `buildPromptsCatalogParagraph`. Bullets that literally name a tool
  outside the exposed set are suppressed — preserves the iter-12
  invariant that the system prompt never references a tool the agent
  cannot call (closes [product#3504](https://github.com/leadbay/product/issues/3504)'s
  spirit at the prompt layer).

### Plugin

- `.claude-plugin/plugins/leadbay/.claude-plugin/plugin.json` bumped
  `0.6.2` → `0.6.3`. Skills are auto-discovered from `skills/` by
  schema convention; no explicit manifest field needed.

### Tests

- `packages/promptforge/test/skills.test.ts` — every `.md.tmpl` has a
  matching `SKILL.md`, every emitted skill is byte-equal to disk
  (freshness gate), every description carries trigger phrasing, no
  unrewritten `{{arg:…}}` survives into the skill body, and the
  catalog string names every prompt + explains the direct-invoke
  fallback.
- `packages/mcp/test/server.test.ts` — two new assertions: default
  config's `instructions` mentions all six prompts; read-only config
  drops `leadbay_qualify_top_n` (its short_description references
  `leadbay_bulk_qualify_leads`, which is gated off).

## 0.6.0 — UNRELEASED — MCP best-practice initiative

The "make `@leadbay/mcp` the example MCP server" rollout. Closes the
P1 / P2 / P3 priorities from the comprehensive eval doc.

### Spec primitive coverage

- **Agentic file-import resolver.** New `leadbay_resolve_import_rows`
  wraps backend `POST /leads/resolve` for messy CSV-shaped user data,
  returns matched / ambiguous / unresolved candidates, optionally
  hydrates ambiguous candidates with active-lens profile facts, and emits
  `records_for_import` + safe identity-only `mappings_for_import` for the
  standard import and import-and-qualify composites. Import mappings now
  accept `LEADBAY_ID`, `CRM_ID`, and `SIREN` as resolver keys in addition
  to name / website. A new `leadbay_import_file` prompt teaches the full
  inspect → map → resolve → disambiguate → import / qualify workflow.
- **Tool annotations on every tool (spec MCP 2025-11-25 §Tools).** Each
  tool now declares `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`, plus a short `title`, so MCP clients (Claude Desktop,
  Cursor) can surface the right confirmation UX per tool. Defaults
  honour the per-tool truth: composite reads are read-only + idempotent;
  composite writes split into idempotent (bulk_qualify_leads,
  enrich_titles, import_leads, import_and_qualify) vs non-idempotent
  (refine_prompt, answer_clarification, adjust_audience-merging,
  report_outreach). 56 tools total. A vitest drift-catcher prevents
  future regressions.
- **`outputSchema` + `structuredContent` on top-5 composites**:
  `pull_leads`, `research_lead`, `account_status`,
  `bulk_qualify_leads`, `report_outreach` now declare typed output
  shapes and emit a matching `structuredContent` block on success.
  Capable clients consume the typed payload without re-parsing the
  text. Backwards-compatible.
- **`prompts/*` capability** with 5 canned slash-commands —
  `leadbay_daily_check_in`, `leadbay_research_a_domain`,
  `leadbay_refine_audience`, `leadbay_log_outreach`,
  `leadbay_qualify_top_n`. Each composes 2-3 tool calls and accepts
  parameterised arguments.
- **`resources/*` capability** with three URI schemes:
  `lead://{uuid}/profile`, `lens://{id}/definition`,
  `org://taste-profile`. Cache-friendly for clients that opt in.
- **`notifications/progress`** — long-running composites stream
  per-lead progress when the client passes `_meta.progressToken`.
  `bulk_qualify_leads` is the first adopter.
- **`notifications/cancelled` → `ToolContext.signal`** — client
  cancels now actually abort in-flight composite polling.

### Hardening

- **`additionalProperties: false` on every tool's inputSchema.** Closes
  the prompt-injection extra-field surface. **Behavior callout**: any
  client that was passing extra unrecognized fields will now get a
  schema rejection. Documented as a deliberate hardening; existing
  tools never advertised acceptance of those fields.
- **Security regression suite** — `packages/mcp/test/security.test.ts`
  covers: extra-field rejection, prototype-pollution payload, type
  confusion, oversized inputs, nested-additionalProperties on the
  `verification` field of `report_outreach`.

### Field renames + deprecations

- **`research_lead.qualification[]` boost_score canonical alias.** The
  field was previously labelled `score_0_to_10`; the actual scale is
  the discrete `-10|0|10|20` boost (NOT a 0–10 average). 0.6.0 ships
  `boost_score` as canonical alongside an explicit `score_scale:
  "-10|0|10|20"` field; `score_0_to_10` is kept as a deprecated alias
  for one minor version and removed in 0.7.0. See `MIGRATION.md`.

### Token economy

- **Pagination metadata**: `pull_leads` and `discover_leads` payloads
  now include `has_more: boolean` and `next_page: number | null`.
- **Truncation steering on `research_lead`**: when the response
  exceeds ~25k characters, `truncated: true` and `truncation_hint`
  surface, naming the argument that would reduce the payload
  (`concise: true`).

### Tests

- Total: 328+ unit tests across `@leadbay/core` and `@leadbay/mcp`.
- New: `annotations.test.ts` (drift catcher), `security.test.ts`
  (5 hostile-input shapes), `output-schema.test.ts` (top-5 round
  trip), `cancellation.test.ts` (signal wiring), `progress.test.ts`
  (event flow), `prompts.test.ts` (5 prompts round-trip),
  `resources.test.ts` (3 URI schemes round-trip).

## 0.3.0 — 2026-04-29

- **`@leadbay/mcp` 0.3.0**: closes [product#3504](https://github.com/leadbay/product/issues/3504) end-to-end. Composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, `bulk_qualify_leads`, `enrich_titles`, `answer_clarification`, `import_leads`) are now ON by default — `LEADBAY_MCP_WRITE` defaults to `"1"`. The `SERVER_INSTRUCTIONS` is now built dynamically from the actual exposed tool set, so the system prompt no longer references tools the server doesn't register. `leadbay-mcp login` defaults to writing a 0600-mode credentials file at the platform-correct path (`$XDG_CONFIG_HOME/leadbay/credentials.json`, `~/Library/Application Support/leadbay/credentials.json`, or `%APPDATA%\leadbay\credentials.json`); pass `--unsafe-print-token` for legacy CI flows. `leadbay-mcp install` now registers Claude Code at `--scope user` so the MCP server is visible from any project. **Behavior callout**: in 0.2.x the parser only recognized `LEADBAY_MCP_WRITE === "1"` as ON; 0.3.0 also accepts `true|yes|on` as ON. See `packages/mcp/MIGRATION.md`.

## 0.2.5 — 2026-04-28

- **`@leadbay/mcp` 0.2.5** + **`@leadbay/core` 0.2.5**: new `leadbay_import_leads` composite write tool ([product#3537](https://github.com/leadbay/product/issues/3537)). Imports a list of company domains and returns Leadbay leadIds for the ones the crawler already knows, chainable into `leadbay_bulk_qualify_leads` and `leadbay_research_lead`. Writes user state (creates a CRM-imports row visible in the web UI). Gated behind `LEADBAY_MCP_WRITE=1` (MCP) and `exposeWrite: true` (OpenClaw). See package CHANGELOGs for full surface, error codes, and limitations.

## 0.1.0 — 2026-04-20

Initial release.

### Tools (11)

Read-only (enabled by default):
- `leadbay_login` — authenticate with email + password
- `leadbay_list_lenses` — list saved search configs
- `leadbay_discover_leads` — AI-recommended leads
- `leadbay_get_lead_profile` — full lead profile with AI scores and web insights
- `leadbay_get_lead_activities` — lead activity feed
- `leadbay_get_taste_profile` — organization ICP + intent tags + qualification questions
- `leadbay_get_contacts` — contacts for a lead
- `leadbay_get_quota` — enrichment credit balance

Write (opt-in, `optional: true`):
- `leadbay_qualify_lead` — trigger AI qualification
- `leadbay_enrich_contacts` — enrich email/phone
- `leadbay_add_note` — add a note to a lead

### Tests

- Contract test: manifest ↔ code parity
- Unit tests: client error mapping, caching, tool branches
- Live smoke tests (opt-in via `LEADBAY_TEST_TOKEN`)
