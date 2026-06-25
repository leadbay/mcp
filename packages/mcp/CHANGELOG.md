# Changelog — @leadbay/mcp

## 0.23.7 — 2026-06-25

Field-sales tour always renders the map (product#3779).

- **`leadbay_plan_tour_in_city` / `leadbay_tour_plan`** — a plain-language tour intent ("I'm visiting Jacksonville in 3 days — who should I go see?") now deterministically routes to the tour tool (no longer leaks to `leadbay_pull_leads`), builds the mixed tour (known accounts + fresh prospects), and **proactively offers to plot it on a map** — every run, without the user asking. On acceptance it renders via `places_map_display_v0` (or the place-card carousel on hosts without the widget).
- **Server-shaped `map_locations[]`** — leads are pre-shaped server-side (`{name, address, latitude, longitude, notes}`, badge in `notes`) plus a `map_summary`, so the agent never hand-builds the widget payload and passes coordinates through verbatim (no fabricated pins/addresses). Each stop is badged ★ Customer / ★ Qualified / ✦ New from real history fields (`epilogue_status` / `last_prospecting_action_at` / `last_monitor_action_at`). Guards against a `"null"`-string contact name.

## 0.23.6 — 2026-06-25

Geographic filter on Discover lenses (product#3759).

- **`leadbay_new_lens` / `leadbay_adjust_audience`** now accept `locations` / `exclude_locations` — a geographic dimension on the Discover lens, mirroring the sector path. Free text (`["Indre-et-Loire"]`, `["Texas"]`) auto-resolves via `/geo/search`, or pass admin-area ids directly. Resolution happens first: ambiguous/unresolved text returns `ambiguous_locations` and the lens is **not** mutated (no half-built lens). Resolved ids merge into the lens filter as a `location_ids` criterion. Unblocks the "scope a territory → net-new accounts there" cockpit workflow — geography was previously settable only on the Monitor side.

## 0.23.3 — 2026-06-24

- **Release plumbing only** — no functional change. First release on the updated CI that also publishes fixed-name `leadbay-latest.dxt` / `.mcpb` assets, so the docs can link a stable `…/releases/latest/download/leadbay-latest.dxt` that always resolves to the current version.

## 0.23.2 — 2026-06-24

- **Installer GUI shows the version** (product#3799) — the installer and uninstaller GUI cards now display the MCP version (e.g. `v0.23.2`) as a small muted-grey footer. Sourced from the build-time `__LEADBAY_MCP_VERSION__` define, so it tracks `package.json` with no manual upkeep.

## 0.23.1 — 2026-06-22

Retrieve + modify qualification questions and CRM custom fields over MCP (product#3768).

- **`leadbay_get_qualification_questions`** (new, always-on read) — the org's AI-agent qualification questions (the criteria every lead is scored against), with the caller's `is_admin` flag. Fetches the questions endpoint directly, so a transient backend/auth failure surfaces as an error rather than a false "none configured".
- **`leadbay_set_qualification_questions`** (new write) — add / remove / replace the org's questions. Reads the current list and posts the full result; enforces the backend's 5-question cap; **any change that drops an existing question requires `confirm:true`** (gated on the actual removed set, so a same-count swap still confirms).
- **`leadbay_get_lead_custom_fields`** (new, always-on read) — the CRM custom-field VALUES stored on one lead (`{id, name, type, value}`), distinct from the definitions catalog in `leadbay_list_mappable_fields`. Fires `LEAD_SEEN`.
- **`leadbay_update_custom_field` / `leadbay_delete_custom_field`** (new writes) — rename/retype a field in place, or delete it (delete requires `confirm:true`). Config is sanitized per type (and a stringified config is parsed) so the backend's strict deserializer never rejects it; the input schema advertises `object | string | null`.
- Modify tools are admin-scoped server-side (every user is admin of their own org). Requires backend leadbay/backend#1906 so OAuth tokens are accepted on the org + custom-field routes.

## 0.23.0 — 2026-06-21

Guided campaign builder.

- **`leadbay_build_campaign`** (new prompt + auto-generated Claude skill) — one guided on-ramp from "build me a campaign" to a ready-to-work campaign: discover on the active lens → qualify → pick an ICP pool → enrich the BUYER PERSONA of the user's product (a sales tool's buyer is the revenue org — VP/Head/Dir Sales, BD, CRO, CMO, growth — not whoever is most senior) → create the campaign → render the `leadbay_campaign_call_sheet` view → hand off to `leadbay_work_campaign`.
- **Coverage guarantee** — drops/swaps any lead with no enrichable buyer-persona contact for the highest-score in-ICP lead that has one (never trading ICP for coverage), and a ⚠ flag for suspect emails (domain ≠ company, or a contact on >1 lead). Polls enrichment to completion before rendering.
- Pure orchestration of existing composites — no new tool. Eval workflow #34 added; tuned over 4 live eval cycles (campaign quality 3/7 → 11/11 leads with a real revenue buyer reachable).

## 0.22.0 — 2026-06-20

Headless artifact SDK + two always-on read tools, so the user's Claude (cowork) can build interactive HTML artifacts that call Leadbay.

- **New package `@leadbay/components`** — vanilla view-models (`lb.field` / `action` / `resource` / `list`, plus domain helpers `outreach`, `note`, `like`/`dislike`, `leadHistory`, `leadProfile`, `callList`, `enrichment`, `teamActivity`) that own a control's data lifecycle: populate-from-API, value/loading/error, validation, polling, request sequencing, a 30s call timeout, and the `report_outreach` verification + `_triggered_by` footguns. The agent owns 100% of markup; the library renders nothing. The build emits a minified runtime into core; a `components:check` drift guard fails CI if the committed runtime goes stale.
- **`leadbay_artifact_kit`** (always-on read) — returns the runtime string + a usage guide the agent reads to assemble an artifact. Lives in `tools/` (granular-shaped) so a kit fetch carries no `_triggered_by` mandate.
- **`leadbay_team_activity`** (always-on read) — per-rep activity leaderboard + activity trend for a look-back window, wrapping `/kpi/users` + `/kpi/trends` (the web Dashboard-Manager data). Admins get the whole org; non-admins are scoped to themselves by the backend.

Validated by agent-dogfood tests: an independent agent builds a working cold-call sheet + a manager dashboard from the usage guide alone, and jsdom asserts the real tool calls fire with the right args. (Core 0.8.4, components 0.3.1.)

## 0.21.3 — 2026-06-19

Kills the 401 startup "reconnect Leadbay" hallucination — the assistant told users to re-authenticate on a connection that actually worked (product#3761). Fixed at every layer that produced or surfaced the spurious 401:

- **`leadbay_account_status` withholds an unreadable quota from the payload entirely** (the actual source the user hit): `account_status` fans out `/users/me` (identity, succeeds) + `/organizations/{id}/quota_status` (quota), and for an org with no billing plan (`plan: null`) the backend's `quota_status` returns **401** on the very token that just succeeded. The old code surfaced that as `quota_error: {code: AUTH_EXPIRED, http_status: 401}`, and both the tool description and the `quota_error` schema told the agent *"on 401/403 tell the user to reconnect"* — so a perfectly-authenticated user was told to reconnect, every time, on a plan-less org. A 401/403 quota failure is now dropped from the response before the agent can see it (only logged); a genuine non-auth failure (500 / network) still surfaces as `quota_error` so the agent can honestly say quota is unreadable. Guidance alone was leaky — an agent still hedged *"quota had a hiccup"* — so withholding it is the only thing the agent literally cannot parrot. Locked by `account-status-quota-401.test.ts`.
- **`leadbay_account_status` gates the active lens on the trigger text, and uses the name not the raw id**: the agent was volunteering the active lens unprompted and surfacing the bare numeric id (e.g. `40005`). The lens (id and resolved name) is now withheld from the payload unless the user's message mentions lens / audience / targeting / segment / filter — the verbatim `_triggered_by` slice is plumbed through to `ToolContext` so the composite gates on what was actually asked (prompt guidance alone leaked the lens unprompted in ~1/3 of live runs). When asked, it resolves `last_requested_lens` → `last_requested_lens_name` (best-effort via `/lenses`, ids string-normalized so the match never drifts string-vs-number), and the agent answers with the name, never the number. (Core 0.8.3.)
- **Hosted HTTP MCP — empty the 401 OAuth-challenge body**: the Fly connector answers an unauthenticated / expired `POST /mcp` with `401` + `WWW-Authenticate` — the RFC 9728 OAuth challenge that drives host sign-in / silent refresh (added in 0.21.0), correct and unchanged. The bug was the challenge's *JSON body* ("Sign in with Leadbay again."), which a spec-compliant client never reads but Claude's host surfaces to the LLM, which then told the user to reconnect even though the immediate retry succeeded. `sendChallenge()` now returns an empty 401 body; the status and the `WWW-Authenticate` header (incl. `error="invalid_token"` for expired) are preserved byte-for-byte, so no protocol signal is lost. Test: `http-auth-challenge-body.test.ts`.
- **Local (stdio) MCP — `TRANSIENT_401` server-instruction**: Leadbay bearer tokens don't expire on a timer, so the client already treats a GET 401 as a transient blip and auto-retries once; only a *persistent* 401 surfaces (as `AUTH_EXPIRED`). But the agent still occasionally read a lone 401 as a broken login and told the user to reconnect even though the next call worked. A new always-on server-instruction paragraph tells the agent a one-off 401 is a brief Leadbay-side hiccup the client already retried — retry silently, never turn it into a "reconnect" message, and surface it only if calls keep failing (offered to `leadbay_report_friction`). Retry count and the `AUTH_EXPIRED` code are unchanged, so a real logout/revocation still surfaces. Test: `server-instructions-transient-401.test.ts`.

## 0.21.2 — 2026-06-17

- **Early host shutdown no longer kills the OAuth flow mid-registration** (review P1): Claude Desktop's probe→teardown can close stdin within ~100ms — while the background bootstrap is still in region-probe/discovery/registration, before any browser-open exists. `shutdown()` now waits (bounded ~4s) on the whole bootstrap task, not just the browser-open promise, so the flow reaches the authorize-URL mint + open dispatch instead of dying early. Verified: stdin closed at 1s still produced `spawn OK` at ~2.7s.
- **Terminal bootstrap failures surface `AUTH_FAILED`, not a forever-"pending"** (review P2): a non-browser failure (region probe / discovery / registration / token exchange) with no sign-in URL used to leave tools reporting "a browser window should have opened…" indefinitely. The failure reason is now recorded and the gate returns `AUTH_FAILED` with the real error + restart guidance; it takes priority over a stale sign-in link.

- **Browser auto-open now reconstructs a missing `DISPLAY`/`WAYLAND_DISPLAY` on Linux**: a real Claude Desktop install log showed the spawned server's env had `DISPLAY=<unset> WAYLAND=<unset>` (the host strips them inconsistently — present on some launches, absent on others). Without a display var, `xdg-open` spawns "successfully" but can't reach the display server, so no tab opens — the silent install failure. `openInBrowser` now backfills the missing vars from `XDG_RUNTIME_DIR` (the `wayland-N` socket) and `/tmp/.X11-unix` (defaulting to `:0`) before spawning the launcher, and passes that env to the child. Already-set vars are left untouched; non-Linux is unaffected.
- **OAuth client registration is cached & reused** (the actual "nothing opens" root cause): bootstrap was registering a fresh Dynamic-Client-Registration client on every launch, and Claude Desktop's probe-restarts (several launches per install) blew past the backend's ~10-registrations/IP/hour cap — so bootstrap 429'd *before* building a sign-in URL. The registered `client_id` is now persisted per auth server in `~/.leadbay/oauth-client.json` and reused (loopback clients accept any 127.0.0.1 port per RFC 8252), so registration happens at most once and the 429 never recurs.

- **OAuth-on-install for the Claude Desktop `.dxt` no longer fails with "Unable to connect to extension server"**: the bundled stdio server ran the full interactive browser OAuth flow (up to 5 minutes) at startup, *before* answering the MCP `initialize` handshake — so Claude Desktop, which gives a launched extension only a few seconds to respond, timed out the connection and marked the server unreachable. The OAuth bootstrap is now **non-blocking**: the server answers `initialize` immediately with a real (tokenless) client, runs the browser sign-in in the background, and the first tool call returns a transient `AUTH_PENDING` envelope ("Signing you in to Leadbay — a browser window should have opened…") until the token lands. The moment the loopback callback completes, the token is set on the live client and the next tool call executes authenticated — no server rebuild, no restart.
- **Browser auto-open now survives Claude Desktop's install-time probe race**: a freshly-installed extension is probed with rapid connect→shutdown cycles (the first spawned process can live <100ms — confirmed in the install logs), which killed the process before the background OAuth flow reached the browser-launch step, so no tab opened on install even though it works on a stable session. The bootstrap now fires the browser-open the moment the authorize URL is known (tracked in an in-flight handle), and the shutdown path waits up to 1.5s for that spawn to dispatch before exiting — the detached launcher then survives our exit. Net: the browser opens on install. The clickable sign-in link remains as the backstop.
- **The sign-in link is also surfaced to the user instead of relying solely on auto-opening a browser**: the spawned `.dxt` stdio process frequently can't open a GUI browser at all — Claude Desktop strips `PATH` *and* `DISPLAY`/`WAYLAND_DISPLAY` from the child env, so `xdg-open`/`open` either `ENOENT`s or (worse) silently exits 0 without launching anything, leaving the user with no link and no error. The bootstrap now captures the live OAuth authorize URL and the gate returns it as a **clickable sign-in link** in the tool envelope ("Open this link to authorize Leadbay…"); the loopback listener stays alive in the background, so clicking it completes the flow and the next tool call is authenticated. The browser auto-open is still attempted (best-effort, now via absolute launcher paths `/usr/bin/open` / `%SystemRoot%\System32\cmd.exe` / `/usr/bin/xdg-open`) for environments where it works — but the surfaced link is the reliable path and no longer depends on it.

## 0.21.1 — 2026-06-16

- **CSV import no longer 400s on a lead status the agent didn't uppercase** (product#3745): `leadbay_import_leads` / `leadbay_import_and_qualify` forwarded `default_status` / `statuses` values verbatim to `POST /imports/{id}/update_mappings`, whose backend `MappingsPayload` decodes them as the strict, case-sensitive `LeadStatus` enum (`DEFAULT, INBOUND, UNWANTED, WANTED, LOST, WON`). A value like "Won" failed deserialization and the whole call 400'd with an opaque "JSON deserialization error" before any record committed — JM hit this trying to tag 179 companies as Won. The MCP now owns the canonical set and enforces it before sending: status values are matched case-insensitively to their enum member ("Won" → "WON"), an empty default means no default, and a genuinely unknown status returns a clear `IMPORT_INVALID_STATUS` error naming the valid values instead of an opaque backend 400. The two tools' input schemas now declare the enum.

## 0.21.0 — 2026-06-16

- **Hosted MCP now triggers OAuth sign-in in Claude Desktop / ChatGPT** (remote custom connectors): the Fly endpoint was not an OAuth-compliant resource server, so a remote client had nothing to discover, never prompted the user to sign in, and then surfaced a host-side "needs auth / token expired" state even though the user never had a token. The server now implements the MCP authorization spec (RFC 9728): it serves OAuth 2.0 Protected Resource Metadata at `/.well-known/oauth-protected-resource[/<resource>]` and answers an unauthenticated (or invalid/expired) `POST /mcp` with `401` + `WWW-Authenticate: Bearer ... resource_metadata="…"`. The client discovers the Leadbay authorization server (the existing regional backend used by `login --oauth`) and runs the browser sign-in. Tool requests auto-probe both regions, so a valid token routes correctly and a stale one re-prompts instead of erroring.
- **Region-pinned connector URLs**: OAuth discovery runs before sign-in and Leadbay tokens are region-scoped, so the region is encoded in the URL. US accounts use `https://leadbay-mcp-prod.fly.dev/mcp`; FR accounts use `https://leadbay-mcp-prod.fly.dev/fr/mcp`. The path only selects which authorization server the sign-in prompt points at. Permissive CORS + an `OPTIONS` preflight are served on the discovery and MCP endpoints for browser-based remote clients. README's remote-client section updated to document Claude Desktop and the per-region URLs.

## 0.20.1 — 2026-06-15

- **Triage board stays the first next-step option on a poor-fit batch** (`leadbay_daily_check_in`): when today's batch is an ICP mismatch (every lead AI-scored off-profile), the agent was demoting the interactive triage board below "refine audience" in the NEXT STEPS widget — the plain ordering rule kept losing to the agent's own leverage judgment ("the whole batch is junk, so lead with fixing the lens"). The workflow contract requires the named artifact to be the FIRST option. The ordering rule now holds the triage board at position 1 even on a mismatched batch; the mismatch is surfaced in the prose nudge and offered as a *later* "refine the lens" option, never by displacing the artifact. Verified 5/5/5/5 across 3 consecutive eval runs on an all-off-ICP batch (the exact case that defeated the weaker rule).

## 0.20.0 — 2026-06-15

- **Proactive update proposal on a fresh session** (product#3742): the auto-update check already ran at boot, but the resulting proposal only reached the user if the agent happened to call `leadbay_account_status` — which a fresh session rarely does, so the "newer version available" prompt was effectively invisible. The cached `update_available` block now also rides along on `_meta.update_available` of the **first ordinary tool result** of a session while an upgrade is pending, gated once-per-version so it surfaces exactly once. `leadbay_account_status` keeps carrying it as a top-level field. The server-instruction paragraph now tells the agent to surface the `ask_user_input_v0` prompt whenever it sees the field on *any* response.
- **Installer asset is now `.dxt`, not `.mcpb`**: the release-asset picker prefers the `.dxt` bundle (falling back to `.mcpb` only when a release ships no `.dxt`). The field is renamed `mcpb_url` → `install_url` across `update_available`, the `leadbay_acknowledge_update` result, and the persisted update-state — with forward-migration of the legacy `latest_known_mcpb_url` key so existing users don't lose their cache.

## 0.19.3 — 2026-06-15

- **New tool `leadbay_send_feedback`**: delivers a user-authored message to the same destination as the web app's "Send feedback" form — the team's Sentry feedback inbox (the website form calls `Sentry.captureFeedback`; there is no Leadbay API endpoint, so the MCP reuses its already-initialized `@sentry/node`). User-initiated ("send feedback / report a bug / tell Leadbay…"), or offered on a tool error and sent only on explicit yes. Distinct from the silent, agent-detected, PostHog-only `leadbay_report_friction`: feedback is explicit, user-authored, and reaches the team's inbox. Honest delivery — if the Sentry transport isn't available it returns `sent:false`, never a false success; Sentry is flushed after capture so the event actually ships; identity is attached when it resolves (anonymous fallback rather than dropping the message). Write-gated (`LEADBAY_MCP_WRITE=1`) since it sends data outward.

## 0.19.2 — 2026-06-10

- **Stop paging Sentry on a missing `_triggered_by`**: a composite tool called without `_triggered_by` is a recoverable agent mistake — the host just re-calls with the field set. The guard used to `throw` an `{error:true, code:"LAST_PROMPT_REQUIRED"}` envelope into the shared catch, where `isLeadbayBusinessError` matched it and fired `captureException`, auto-opening a top-priority Sentry/GitHub bug (product#3718) on every dropped field. The guard now returns the `isError` envelope directly. Behavior toward the LLM is unchanged (same text, same `isError`, same recovery hint), and PostHog visibility is preserved (`captureToolCall` + `captureCompositeCall` still fire `ok:false` / `LAST_PROMPT_REQUIRED`, so the mandate-ignore rate stays observable); only `captureException` is dropped.
- **`_triggered_by` is now an always-mandatory, auditable protocol field**: reframed from analytics-only to a required intent trace, collected on every composite call regardless of the telemetry setting (when telemetry is off the value is captured locally but never transmitted, so the opt-out is still honored). A new server-instruction mandate paragraph reinforces the JSON-schema field description that agents kept ignoring. The `<no user message>` magic-string sentinel is gone — agent-initiated calls (memory recall, scheduled run, retry) now pass the actual instruction being acted on, so the field is genuinely non-empty in every case.

## 0.19.1 — 2026-06-09

- **New tool `leadbay_scan_portfolio_signals`**: read-only bulk scan of a Monitor portfolio (or an explicit lead-id list) for a web-research signal. Ask "which of my leads have an M&A / funding / hiring signal since 2025" and get the matched cohort back in one call — a `GET`-only fan-out over cached `web_fetch` signals (no per-lead research loop, no AI-qualification quota burn), with a case- and accent-folded query and optional `since` date. The matched cohort is campaign-ready (feeds straight into `leadbay_add_leads_to_campaign`).
- **Signal-honesty guardrail**: the scan separates `not_researched[]` (no cached content) from "no match", so the agent can never claim coverage for leads it never read. Reinforced in `leadbay_pull_followups`, `leadbay_research_lead_by_id`, and the `followup_check_in` prompt: freshness fields (`stale_at`, `web_fetch_in_progress`, `fetch_at`) are not signal indicators, and portfolio-wide signal questions route to the bulk tool. Every error path stays honest — a 429 while paging the portfolio, a non-quota read failure, and a failed filter-store all surface partial coverage rather than reporting a confident empty result.
- **Agent-side gap-fill in the follow-up check-in**: PHASE 3b turns the coverage gap into a refinement loop — the agent names the gap, runs a targeted live web pass on only the `not_researched` / thin-signal leads, and folds findings back in clearly labelled as agent-sourced (not Leadbay-verified), with `leadbay_bulk_qualify_leads` offered as the durable path that writes the signal into the portfolio.

## 0.19.0 — 2026-06-09

NEXT STEPS, artifact, and scheduled-task offers now fire reliably as host widgets across Claude chat, Claude cowork/Desktop, and ChatGPT.

- **Deterministic `next_steps` on `leadbay_pull_leads`** — the server now returns a ready-made `{question, options[]}` object with the "Build an interactive lead triage board" artifact offer pinned at `options[0]` whenever the batch is non-empty (`null` when empty). The model renders it verbatim into the host widget instead of re-deriving options from prose, which is where the artifact offer kept getting dropped.
- **Dual host-widget schema documented** — the next-step / choice widget differs by host: `ask_user_input_v0` (Claude chat / ChatGPT) takes plain-string options with `type:"single_select"`; `AskUserQuestion` (Claude cowork / Claude Code) takes `{label, description}` objects with a required short `header` and `multiSelect`, no `type`. Both are now documented (full forms in `host-widgets.ts`, compact form in the shared next-steps snippet) and made widget-mandatory-when-available.
- **WORKFLOWS.md** — added WF#16 (artifact proposal gate), WF#17 (recurrence routing gate — recurrence language runs the daily discovery check-in, not follow-ups), WF#18 (widget overdelivery guard).

## 0.18.2 — 2026-06-09

- **Release-pipeline fix**: align `packages/mcp/server.json` with `package.json`. `server.json` had been stuck at `0.17.2` since the 0.17.2 release, so the MCP-Registry publish step (`Verify server.json version matches package.json`) failed on every release from 0.17.3 through 0.18.1 — npm and the GitHub `.mcpb` shipped, but the registry listing silently went stale. Both `server.json` version fields (top-level + `packages[0].version`) now track `package.json`, and a new audit test (`test/audit/server-json-version.test.ts`) fails the build on any future drift instead of letting it surface only at release time.

## 0.18.1 — 2026-06-09

- **Quota rendering fix**: `leadbay_account_status` now renders the per-resource Daily / Weekly / Monthly **usage** table the API actually returns, instead of collapsing to "quota: null / no limits". Root cause: `quota_status` returns `count` (amount **used**) per resource per window with no cap field and a possibly-`null` `plan`; the old render hint tried to draw `used / cap` and gave up when there was no cap. The hint is now usage-only and explicitly warns that a missing cap / `null` plan is **not** "unlimited" or "no quota". `get-quota.ts` `outputSchema` corrected to the real `org` / `user.resources[]` shape (`{resource_type, count, window_type, resets_at}`, `count` = used), and a failed quota fetch is now distinguished from an empty quota.
- **Enrichment credit spend**: `leadbay_enrich_titles` surfaces the credit balance before and the actual spend after a run, reported discreetly rather than as a callout. Dropped the per-run "credits used" figure that conflated prior enrichments.

## 0.18.0 — 2026-06-08

Backend long-task notifications are now consumed by the MCP. When the user (or agent) initiates a bulk operation — contact enrichment, lead qualification, CSV / CRM import — the MCP listens to the backend WebSocket for the completion event and surfaces it on the agent's next tool call so prior outputs that depended on the now-finished data can be revised.

- **WS listener** — `wss://api-*.leadbay.app/ws/1.0?t=<ticket>` (ticketed via `GET /auth/ws?v=1.0`), reconnects with exponential backoff, REST catch-up via `GET /notifications` on every (re)connect and on cold start. Opt-out: `LEADBAY_NOTIFICATIONS_WS_DISABLED=1`.
- **`_meta.notifications` on every tool response** — terminal bulk-progress notifications appear on every successful tool call until the agent acknowledges them. Auto-expires after 24h locally to prevent unbounded growth in unattended automation.
- **`leadbay_account_status.notifications`** — same entries surfaced as a top-level field so the agent's daily-rhythm check-in sees them without reading `_meta`.
- **`leadbay_acknowledge_notification(notification_id, archive?)`** — new always-exposed tool. Posts `/notifications/{id}/seen` (default) or `/archive`, removes the entry from the local inbox. The agent calls this *after* it has revised prior outputs the just-finished work might have made stale.
- **Launch endpoints return `notification_id`** — `leadbay_enrich_titles`, `leadbay_bulk_qualify_leads`, `leadbay_import_leads`, and `leadbay_import_and_qualify` now read the canonical `notification_id` from `BulkLaunchResponse` / `BulkWebFetchResponsePayload` and persist it on the bulk tracker record.
- **`bulk_qualify_leads` now uses the selection-based bulk endpoint** — replaces per-lead fan-out so the backend creates a single progress notification per call. Per-lead error attribution is coarser at launch (leads outside `queued_ids ∪ skipped_ids` are tagged `not_queued`); the polling phase still pulls concrete per-lead state.
- **`bulk_enrich_status` fast path** — reads `bulk_progress` from the notification in a single REST call instead of fanning out `get_contacts` per lead. Falls back to the legacy per-lead path for records minted before this PR.
- **`qualify_status` surfaces `bulk_progress`** — bulk counters (success / failure / quota_hit) appear alongside the existing per-lead refresh. `quota_hit_count > 0` triggers an upgrade-or-wait hint.
- **Vocabulary**: "notifications" everywhere. Not "pending actions", not "tasks", not "async results" — matches the backend ADR (`docs/adr/notifications.md`).

## 0.17.3 — 2026-06-01

- **Lens management on the default surface**: lenses are now fully manageable from chat, no `LEADBAY_MCP_ADVANCED` needed.
  - `leadbay_my_lenses` (write) — list your lenses, switch the active one, rename / set description, or delete (delete is confirm-gated and refuses the default lens).
  - `leadbay_new_lens` (write) — create a named lens with sector/size criteria in one call; previews and confirms before creating, and rolls back the created lens if applying its filter fails (no orphan half-built lenses).
  - `leadbay_adjust_audience` — new `lensName` param edits a lens **by name** without switching your active lens (edit-only).
  - `leadbay_list_sectors` (read, always-on) — the sector taxonomy lookup, so the agent stops guessing sector names.
- **Routing**: `leadbay_adjust_audience` and `leadbay_refine_prompt` gained routing blocks so "create a lens" reaches `new_lens` (not `refine_prompt`) and "add X to my Y lens" fills `lensName` instead of editing the active lens.
- **Backend contract fixes** (were causing `400 JSON deserialization error` on lens create/edit, verified live): `POST /lenses` `base` sent as a string; `POST /lenses/:id/filter` sent as the unwrapped `{items:[…]}` body; `size` criteria carry both `min` and `max`.

## 0.17.2 — 2026-06-01

- **Linux installer fix**: skip Electron when no display is available (`$DISPLAY`/`$WAYLAND_DISPLAY` unset) and go straight to browser fallback — eliminates the double GUI URL on headless Linux terminals.
- **Browser open fallbacks**: on Linux, try `xdg-open` → `sensible-browser` → `google-chrome` → `chromium-browser` → `firefox` in order. If all fail, print a clear "Open this URL in your browser" message instead of silently doing nothing.
- **GitHub release notes**: release body now contains the actual CHANGELOG section for the version instead of "see CHANGELOG.md".

## 0.17.1 — 2026-06-01

- **Publish fix**: the `installer` npm bin (`npx -y -p @leadbay/mcp@latest installer`) was missing from the 0.17.0 tarball because the package was published before the installer wizard merged. This patch re-publishes with the correct bin entries.

## 0.17.0 — 2026-05-29

- **Lens extension** (product#3654): two new composites that expose the
  backend's agent-driven on-demand lens fill (backend#1844 / api-specs#205).
  - `leadbay_extend_lens` (write, gated by `LEADBAY_MCP_WRITE=1`) —
    `POST /lenses/{id}/extra_refill`. Translates the backend's 429
    `quota_exceeded` / 409 `refresh_in_progress` / 400 `no_valid_seeds`
    errors into routable `status` envelopes. On 429 the response carries
    `quota.used_today` + `quota.resets_at` and a message instructing the
    agent to surface three options to the user (smaller `extra_count` /
    wait for reset / upgrade plan).
  - `leadbay_seed_candidates` (read) — internal scaffolding for the
    extend flow. Returns ranked candidate leads with rich signal
    (description, sector, tags, qq_answers, engagement). The agent picks
    3–5 seeds silently and chains to `extend_lens`; the user never
    reviews the seed list.
- New prompt `leadbay_extend_my_lens` orchestrates the four-phase flow:
  quota pre-check → silent seed pick → fire extend → react to status.
- `leadbay_account_status` description now mentions the per-org daily
  `LENS_EXTRA_REFILL` quota — pre-check it before calling
  `leadbay_extend_lens`.

## 0.16.2 — 2026-05-29

- **Tighter `_triggered_by` description on composite tools.** Live test of
  0.16.1 showed Claude shipping the literal string `"user"` as
  `_triggered_by` — technically non-empty, but useless for analytics. The
  description now explicitly forbids single-word labels (`user`, `agent`,
  `leads`, `request`, etc.), gives a GOOD/BAD example pair, and tells the
  agent to pass `<no user message>` when it's acting without a fresh user
  turn (memory recall, scheduled run, self-initiated retry) so the
  agent-initiated path is auditable instead of falsely attributed.

## 0.16.1 — 2026-05-29

- **`_triggered_by` is now MANDATORY on every composite-file tool** (the 28
  tools whose source lives under `packages/core/src/composite/`). Calls
  without it are rejected pre-dispatch as `LAST_PROMPT_REQUIRED`. Granular
  and agent-memory tools keep `_triggered_by` optional. Stronger
  description text on the schema property tells the agent to quote
  verbatim and strip secrets (`[REDACTED]`).
- **New PostHog event `mcp composite call`** with `last_prompt` attached
  (the trimmed verbatim user quote). Fires on every composite-tool
  invocation, success or error. Lives alongside the existing
  `mcp tool called` event — no regression on the broader pipeline. Lets
  dashboards filter user-language against composite outcomes without
  the 60-70% null rate the optional-everywhere `triggered_by` field
  carries on `mcp tool called`.

## 0.16.0 — 2026-05-29

- **Guided installer wizard**: Electron GUI (browser fallback) for install and uninstall. Detects Claude Code, Claude Desktop, Cursor, Codex, and ChatGPT Desktop automatically. OAuth sign-in built in — no token copy-paste.
- **Hosted MCP server**: Hono HTTP server at `https://leadbay-mcp-prod.fly.dev/mcp` for ChatGPT Desktop and other remote-MCP clients. Supports Streamable HTTP (`POST /mcp`) and legacy SSE (`GET /sse`, `POST /messages`).
- **Installer logic reorganised**: all install/uninstall logic moved from `src/bin.ts` into dedicated files under `installer/` (`install-claude-code.ts`, `install-json-config.ts`, `install-codex.ts`, `install-dxt.ts`, `install-wizard.ts`). `bin.ts` is now a thin MCP server entrypoint.
- **DXT extension removal**: when Claude Desktop 2026 DXT markers are detected, the installer removes the Leadbay DXT bundle (`Claude Extensions/local.dxt.leadbay.leadbay/` + registry entry) and writes `claude_desktop_config.json` as the authoritative config source.
- **macOS path fix**: `DetectedClient` now carries a `configPath` field; dropped the `detail.split(" ")[0]` pattern that truncated paths containing spaces (e.g. `~/Library/Application Support/Claude/...`).
- **SSE double-write fix**: `/sse` and `/messages` now return the `x-hono-already-sent` sentinel so Hono's Node adapter does not attempt a second header write after `SSEServerTransport` has already written headers.
- **Browser fallback uninstall fix**: `runBrowserFallback()` now opens the uninstaller GUI when `--uninstall` is passed, matching the Electron main process.
- **`@latest` pin**: all generated client configs now use `npx -y @leadbay/mcp@latest` instead of a hardcoded minor version.
- **OAuth login** (`leadbay-mcp login --oauth`): browser-based Authorization
  Code + PKCE flow with Dynamic Client Registration (RFC 7591). No password
  ever touches the CLI. The resulting `o.<token>` is interchangeable with the
  legacy bearer token.
- Region is auto-detected via stargate GeoIP (`stargate.leadbay.app/1.0/user_info`)
  for OAuth. Pass `--region us|fr` to override if you're on a VPN or travelling.
- Pass `--staging` together with `--oauth` to point at `staging.leadbay.app` for
  testing.
- The Claude Desktop `.dxt` / `.mcpb` bundle now opts into OAuth bootstrap on
  first launch. The install dialog no longer asks for a bearer token, region, or
  backend URL; it only exposes the write-tools toggle.
- Existing email-password `login` flow is unchanged and remains available for
  manual installs and CI.
- **Pin bumps**: active `@leadbay/mcp@0.13` install/runtime references in docs,
  generated client config, and MCP Registry metadata now point at `@0.16`.

## 0.15.0 — 2026-05-27

- **Sentry observability**: every non-2xx Leadbay API outcome now lands in
  Sentry with the full envelope — `code`, `message`, `hint`, `endpoint`,
  `region`, `http_status`, `latency_ms`, `retry_after`, agent `triggered_by`.
  Previously business errors (NOT_FOUND, AUTH_EXPIRED, QUOTA_EXCEEDED,
  FORBIDDEN, LEAD_NOT_FOUND, etc.) only landed in PostHog, and even the
  unexpected throws that reached Sentry carried only a bare exception with
  `tool` + `organization` tags. A new `source` tag (`business` vs
  `unexpected`) plus per-event fingerprint `["mcp", tool, code]` keeps the
  Sentry issue list groupable.
- HTTP status now propagates through `LeadbayError._meta.http_status` so
  `API_ERROR` (catch-all unmapped statuses) is filterable by status in
  Sentry instead of collapsing into one undifferentiated bucket.

## 0.13.0 — 2026-05-21

- **Agent memory v1**: added always-on recall/capture/review tools backed by
  local append-only JSONL at `~/.leadbay/memory/{account_id}/`.
- Leads-touching tool responses now attach `_meta.agent_memory.summary` with
  the consolidated top signals unless `LEADBAY_AGENT_MEMORY=off` is set.
- Server instructions, prompt descriptions, and workflow prompts now teach the
  memory protocol, including capture of new taste signals and review-gated
  retractions.
- Added `agent-memory://summary` resource and PostHog events for memory
  capture/recall/prune.
- **Pin bumps**: every active `@leadbay/mcp@0.12` install/runtime reference in
  docs, generated client config, DXT, MCP Registry metadata, and Claude plugin
  metadata is now `@0.13`.

## 0.12.1 — 2026-05-21

MCPB hotfix for Claude Desktop.

- **Fix packaged-server startup**: the MCPB bundle now injects a Node `createRequire` shim before esbuild's ESM wrapper so CommonJS dependencies can still require Node built-ins such as `perf_hooks`. This fixes the Claude Desktop disconnect where the server exited during initialization.
- **Packaging guardrail**: `@leadbay/dxt build` now runs the staged `server/index.js --version` before zipping, and the smoke suite extracts the MCPB and completes a real MCP initialize/tools-list handshake.
- **Manifest refresh**: MCPB manifests now declare `manifest_version: "0.3"` and the smoke assertions match the current MCPB manifest spec.

## 0.12.0 — 2026-05-21

Campaign and field-sales workflow release.

- **Campaign workflows**: adds campaign creation/listing, add-leads, progression summaries, and a `leadbay_campaign_call_sheet` composite that returns phone-ready, LinkedIn-ready, and map-ready lead/contact payloads.
- **Agent routing + skills**: adds the `leadbay_work_campaign`, `leadbay_plan_tour_in_city`, and `leadbay_setup_team_prospecting` prompt/skill flows so agents start with readiness checks, route to the right workflow tool, and keep outreach reporting grounded in verified user action.
- **Progression accuracy**: contacted/already-contacted summaries now use outreach/prospecting signals instead of treating contact coverage as outreach completion.
- **Coverage**: adds workflow audits, prompt-eval coverage for `leadbay_work_campaign`, live campaign smoke coverage, and focused unit tests for the new campaign progression/call-sheet composites.
- **Pin bumps**: every `@leadbay/mcp@0.11` install/runtime reference in docs, generated client config, DXT, and Claude plugin metadata is now `@0.12`.

## 0.11.0 — 2026-05-20

In-server auto-update flow: the MCP server now self-polls GitHub releases (24h throttle, ETag-aware, in-flight guarded) and surfaces an `update_available` block on `leadbay_account_status` when a newer version is published — both at boot AND on every tool call, so long-running Claude Desktop sessions still pick up new releases without restart.

- **New tool — `leadbay_acknowledge_update`**: records the user's choice from the `ask_user_input_v0` prompt. `action: 'install'` returns the `.mcpb` download URL (Claude Desktop's native installer opens on click); `'remind_tomorrow'` snoozes 24h; `'skip'` permanently suppresses that version. State persists to `~/.leadbay/update-state.json` (0o600, atomic write, symlink-rejecting; mirrors `bulk-store.ts`).
- **Five new PostHog events** for the funnel + conversion: `mcp_update_check`, `mcp_update_prompted`, `mcp_update_install_clicked`, `mcp_update_dismissed`, `mcp_version_updated` (fires on the next boot under a newer `VERSION` constant — works regardless of how the user upgraded: `.mcpb`, npm, npx).
- **Routing instruction** appended to `buildServerInstructions`: when `update_available` is present on `leadbay_account_status`, the agent prompts via `ask_user_input_v0` with three options and routes the choice through `leadbay_acknowledge_update`. Opt-out: `LEADBAY_UPDATE_CHECK_DISABLED=1`.
- **Pin bumps**: every `@leadbay/mcp@0.10` reference across `bin.ts`, `server.json`, `README.md`, `packages/dxt/manifest.template.json`, `.claude-plugin/.../plugin.json`, and the root `README.md` is now `@0.11`.

## 0.10.1 — 2026-05-20

Documentation + version-pin sweep paired with hardening the release pipeline. No functional changes to the published binary.

- **Pin bumps**: every `npx -y @leadbay/mcp@<old>` reference in `bin.ts` (install command output, error hints, doctor instructions, generated client configs), `README.md`, `server.json` (MCP Registry manifest), `packages/dxt/manifest.template.json`, and `.claude-plugin/plugins/leadbay/.claude-plugin/plugin.json` is now `@0.10`. New installs land on the latest minor.
- **Release pipeline migrated to npm Trusted Publishers OIDC** (`.github/workflows/release.yml`): npm revoked Classic tokens on Dec 9 2025 and Granular tokens with the "Bypass 2FA" flag still hit known publish-rejection bugs ([npm/cli#9268](https://github.com/npm/cli/issues/9268)). The publish step now uses OIDC via the [Trusted Publishers binding](https://docs.npmjs.com/trusted-publishers) configured per-package on npmjs.com. Runtime bumped to Node 24 in publish jobs for the bundled npm ≥ 11.5 that speaks the OIDC handshake (Node 22's npm 10 can't, and self-upgrade via `npm install -g npm@latest` consistently breaks on the runner image).
- **Auto-release** (existing `.github/workflows/auto-tag.yml` — unchanged in this release, documented here): merges to `main` that bump `packages/mcp/package.json#version` automatically push `mcp-v<ver>` and dispatch `release.yml` on the tag, which publishes to npm + MCP Registry + uploads the .dxt to a GitHub Release. No manual tagging needed.

## 0.10.0 — 2026-05-19

First stable cut of the 0.10 line. Consolidates everything since 0.9.1: host-native widget rendering, structured routing schema, the top-up flow, like/dislike write tools, the `research_lead` split, and PostHog + Sentry telemetry. See dev-iteration commits for granular per-PR history; this is the npm-shipped consolidation.

### Host-native widgets + chat-native rendering (#42)

Iframe widget rendering via MCP Apps `_meta.ui` is **removed entirely** — it short-circuited Claude's native widget routing and never blended with chat themes. All tools now render via two surfaces only: (1) chat-native markdown (the canonical `RENDERING` block every tool description carries — tables, cards, chips, headings; inherits the chat's theme + dark-mode for free), and (2) Claude's three first-party widgets when the host exposes them: `places_map_display_v0` (≥2 locations / travel intent), `message_compose_v1` (outreach drafts), `ask_user_input_v0` (NEXT STEPS / clarifications). Same widget-routing pattern applies on ChatGPT via `_meta.openai/outputTemplate`. The `Tool.ui` field is removed from the `Tool` interface — DO NOT re-introduce it.

Hosts that auto-detect addresses in agent prose (Claude.ai web, cowork, Claude Desktop) now get fed per-lead blocks shaped for their Google-Place-card carousel — see the `leadbay_followup_check_in` "TRAVEL / IN-PERSON ROUTING" block as the canonical example.

### Structured routing schema in promptforge (#42)

Every user-facing tool description follows a new 5-section convention enforced by promptforge + audit tests:

```
[1] ## WHEN TO USE   ← auto-emitted from frontmatter.routing
[2] ## RENDER (quick) ← auto-emitted from frontmatter.rendering_hint
---
[3] <free-form body>
[4] {{include:rendering/…}}
[5] {{include:next-steps/…}}
```

Routing frontmatter is structured YAML: `triggers`, `anti_triggers` (with `route_to` cross-references), `prefer_when` decision hint, and ≥3 positive + ≥3 negative example messages per [Anthropic's skill-author guide](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). The audit (`routing-block.test.ts`) asserts the `## WHEN TO USE` block lands within the first 600 chars (the context-truncation window every host honors), anti-trigger `route_to` values resolve to registered tool names, and the example floor (≥2 of each) holds for every routed tool. Backfilled on the 7 user-facing composites in this release.

### Top-up flow + billing tools always-on (#42)

`leadbay_create_topup_link` (POST `/stripe/topup_checkout` → Stripe checkout URL) and `leadbay_open_billing_portal` are now **always exposed** in `compositeReadTools` (not gated behind `LEADBAY_MCP_ADVANCED=1`) because they're the canonical recovery path from a `QUOTA_EXCEEDED` wall. Without them, the agent would know about the wall but not the door out.

`QUOTA_EXCEEDED` error hints now explicitly offer top-up as the path that clears the throttle immediately (vs. waiting for the daily/weekly/monthly window reset). The new `QUOTA_AND_TOPUP_PARAGRAPH` in the server instructions tells the agent to OFFER top-up on every quota wall and, after the user signals they've topped up, RESUME the originally-failed call rather than gate-keeping on a stale `account_status` snapshot.

New composite `leadbay_followups_map` for travel / itinerary / state-level intent — handles NYC/SF/LA city aliases and a universal `city` arg that resolves state/country/region levels server-side.

### `research_lead` split (#43)

`leadbay_research_lead` / `leadbay_research_company` are replaced by a pair whose **input mode is in the name itself**:

- `leadbay_research_lead_by_id` — exact UUID lookup; rich composite carrying qualification + signals + firmographics + two-tier contacts + unified `recent_activities` + engagement counts + `web_insights_fetched_at` + `_meta`. The `_meta.has_reachable_contact` flag is the one-shot signal that drives NEXT STEPS (false → propose `leadbay_enrich_titles`; true → propose `leadbay_prepare_outreach`).
- `leadbay_research_lead_by_name_fuzzy` — thin wrapper that resolves a `companyName` against the active lens's top-50 wishlist by substring (highest score wins), then delegates to `_by_id`.

Routing collapses to a syntactic choice (UUID vs. name) instead of a semantic guess, which was the source of misroutes when an agent had both a name and a partial ID.

### `leadbay_like_lead` + `leadbay_dislike_lead` write tools (#41)

The thumbs-up / thumbs-down actions already available on the Leadbay website are now MCP tools. Agents can send positive and negative lead signals back to the Leadbay scoring engine to improve future batch quality.

- `leadbay_like_lead` — POSTs to `/leads/{id}/like`. Fires on "this one looks good", "thumbs up", "I like this".
- `leadbay_dislike_lead` — POSTs to `/leads/{id}/dislike`. Fires on "not relevant", "wrong industry", "thumbs down". Distinct from `leadbay_set_pushback` (temporary deferral, not a permanent negative signal).

Both ship in the default write surface (no `LEADBAY_MCP_ADVANCED=1` required); gated by `LEADBAY_MCP_WRITE=1` (default ON since 0.3.0). Descriptions carry the new structured `routing` + `rendering_hint` frontmatter.

### PostHog + Sentry telemetry (#44, closes #3631)

Every tool invocation now fires an `mcp tool called` event to PostHog (same project as the frontend, project id 23333, EU instance), with quota walls surfaced as `mcp quota hit` and successful top-up checkout-link generation as `mcp topup link created`. Unexpected throws (TypeError, network failures, parse bugs) report to a new MCP-specific Sentry DSN; expected `LeadbayError` envelopes (QUOTA_EXCEEDED, NOT_FOUND, AUTH_EXPIRED, FORBIDDEN, BILLING_SUSPENDED, API_ERROR) stay in PostHog only.

- **Identity by email**: PostHog `distinctId = me.email` so MCP events consolidate with web-app events under the same person. Person properties (`leadbay_id`, `leadbay_organization`, `leadbay_organization_id`, etc.) match the frontend's `usePostHog.tsx` shape. **Events are NOT anonymous** — explicitly stated in `--help`, the install banner, and README.
- **`$groups.organization` attached** so org-level rollups work out of the box.
- **Privacy**: we capture `tool`, `duration_ms`, `ok`, `format`, `bytes`, `error_code` — never tool argument bodies, response bodies, lead emails, or Stripe URLs (unit test enforces).
- **Opt-out as a first-class toggle**: `leadbay-mcp install` always writes `LEADBAY_TELEMETRY_ENABLED=true` into your client's env block (next to `LEADBAY_TOKEN` / `LEADBAY_REGION`), so MCP-client config UIs (Claude Desktop, Cursor) render it as a toggle the user can flip without editing files. Pass `--no-telemetry` to install with telemetry off, or flip the env value to `"false"` anytime. Accepted: `true|1|yes|on` (enable), `false|0|no|off` (disable), case-insensitive. Also disabled when `NODE_ENV=test`.
- **Override**: `LEADBAY_POSTHOG_KEY` and `LEADBAY_SENTRY_DSN` env vars override the baked-in defaults.
- **stdio safety**: both SDKs are configured to never write to stdout (the JSON-RPC channel). Sentry runs without its default integrations (no console capture) and shutdown is bounded at 2s to never block process exit.

## 0.9.1 — 2026-05-16

**B23 fix — prompts no longer override per-tool RENDERING blocks**: 0.9.0 shipped RENDERING + NEXT STEPS blocks on every composite tool description. But agents still rendered prose for the daily-leads workflow, because the orchestrating `leadbay_daily_check_in` prompt's Phase 3 directed motivational one-line summaries that "won" over the per-tool RENDERING block in pull_leads. Phase 3 is rewritten to defer to the canonical pull_leads table layout (score bars, three columns, hide-list) and to add a 2–4 sentence "Today's nudges" paragraph ABOVE the table for the 3 most-promising rows — never in place of it. The same pattern is applied to `leadbay_qualify_top_n` (Phase 3 re-pulls newly-qualified leads via pull_leads and renders the canonical table, with a "Standouts from this batch" line above) and `leadbay_research_a_domain` (Phase 2 renders the research-company-card layout for the deep-dive result, with a 2–3 sentence summary above).

**New `gates/defer-to-tool-rendering` snippet — architectural prevention**: a new gate snippet codifies the rule "the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it." Included from every prompt that orchestrates a composite carrying a RENDERING block (`leadbay_daily_check_in`, `leadbay_qualify_top_n`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_prospecting_overview`, and the new `leadbay_followup_check_in`). A new assembler test enforces the gate include: any prompt whose `expected_calls` lists a composite with a RENDERING block MUST include the snippet — CI fails otherwise. Closes the door on future prompts quietly bypassing the contract.

**Discover-vs-Monitor routing fix (companion to B23)**: 0.9.0 shipped `leadbay_pull_followups` (the Monitor view) and `leadbay_pull_leads` (Discover wishlist) as parallel entry points but no orchestrator prompt parallel to `leadbay_daily_check_in` for the follow-up flow. When the user asked "leads I should follow up with today", no prompt auto-triggered and the agent freelanced — typically iterating pages of `pull_leads` filtering by `prospecting_actions_count > 0` (the wrong backend table). Four fixes:

- **New `leadbay_followup_check_in` prompt** — Monitor-view orchestrator paired 1:1 with `leadbay_daily_check_in` (Discovery). Triggers on "follow up", "already known leads", "leads I haven't contacted", "leads in [city]", "before my trip", "this week", "what's overdue", "who should I re-engage". Calls `leadbay_pull_followups` (never `pull_leads`), renders the canonical followups-table with a "Where to start today" paragraph above. Auto-emits as a Claude Code skill via the existing skills pipeline.
- **Narrowed `leadbay_daily_check_in` triggers** — `short_description` rewritten to scope to DISCOVERY phrasings ("best NEW leads", "what's new today", "let's prospect"); explicitly does NOT trigger on "what should I follow up on", "before my trip", etc. New failure_mode entry catches accidental routing into discovery from follow-up queries.
- **Anti-confusion guardrail in `leadbay_pull_followups` description** — names the specific failure mode ("iterating pages of `pull_leads` looking for rows with `prospecting_actions_count > 0` or `notes_count > 0` → STOP, wrong entry point") and points to `leadbay_followup_check_in` as the canonical orchestrator. The pair of backend tables doesn't share rows — a touched lead may age out of the new-leads queue entirely.
- **Routing-pair section in `leadbay_prospecting_overview`** — explicit mapping from user phrasing to orchestrator prompt, plus a hard rule never to call `pull_leads` directly for a follow-up query (or `pull_followups` for a discovery query).

**Server-side fix to the catalog filter**: the `buildPromptsCatalogParagraph` filter that drops bullets referencing unexposed `leadbay_*` tools now exempts prompt-name references too (prompts are always exposed). Previously a discovery bullet that pointed the follow-up flow to `leadbay_followup_check_in` would have been silently dropped from the catalog.

**Six new regression eval scenarios**: B23 rendering — `daily-check-in/rendering-table-contract`, `qualify-top-n/rendering-refresh-table`, `research-a-domain/rendering-card-contract`. Routing — `followup-check-in/routing-regression` (calls `pull_followups`, NEVER `pull_leads`), `followup-check-in/cross-mode-pivot` (recognizes the pivot offer to discovery), `followup-check-in/geo-followup` (handles geo without fabricating an `admin_area_id`). Picked up automatically by the existing eval framework via the per-prompt eval files; the new `leadbay_followup_check_in.eval.ts` runs all three.

**Files touched**: 1 new gate snippet, 1 new prompt (`leadbay_followup_check_in`), 5 modified prompts (`leadbay_daily_check_in`, `leadbay_qualify_top_n`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_prospecting_overview`), 1 modified tool description (`leadbay_pull_followups`), 1 server.ts catalog-filter fix, 1 new assembler test, 6 new scenario files, 4 modified/new eval files, 1 new invariants module, touchfile registry updated. No backend schema changes; no tool surface changes; same wire protocol as 0.9.0.

## 0.9.0 — 2026-05-16

**RENDERING + NEXT STEPS blocks in every composite tool description**: agents consuming composite tools today default to prose summaries when they don't know how to present the data. Tool descriptions now carry two new prescriptive blocks the agent reads verbatim — `RENDERING` (a recipe for how to present the response: table columns, glyph palette, link targets, fields to hide) and `NEXT STEPS` (an observation → suggestion table the agent picks 2–3 contextually relevant offers from, never reciting the whole menu). Lands on the seven highest-leverage composites: `leadbay_pull_leads`, `leadbay_research_company`, `leadbay_prepare_outreach`, `leadbay_bulk_qualify_leads`, `leadbay_import_leads`, `leadbay_import_and_qualify`, `leadbay_import_status`, `leadbay_list_mappable_fields`, `leadbay_resolve_import_rows`. The blocks add ~5–7k chars per description, so the audit's per-tool char budget was raised from 3500 → 12000 with a comment explaining the design tradeoff.

**Three new snippet categories in promptforge** — `snippets/rendering/` (response-shape recipes: `score-bar`, `pull-leads-table`, `research-company-card`, `prepare-outreach-brief`, `import-result`, `status-inline`), `snippets/next-steps/` (one observation→suggestion table per composite), and `snippets/linking/` (`contact-linkedin` for the priority chain → real `linkedin_page` → people-search fallback with `°`-flag; `company-socials` for the multi-platform `social_urls` pill row). Each composite's `.md.tmpl` now `{{include:rendering/...}}` + `{{include:next-steps/...}}` instead of inlining the rules.

**New iron-law `outcome-after-outreach`**: when the user reports outreach happened ("I sent it", "she didn't pick up", a forwarded email thread), the agent MUST (a) call `leadbay_report_outreach` with verification AND (b) ask about the outcome and set `epilogue_status` to one of the 4 canonical values. User-facing dialogue uses "outcome" not "epilogue"; "follow-ups" not "Monitor". Included from `prepare_outreach.md.tmpl` and the new prospecting-overview prompt. Closes the loop that was silently de-ranking every future follow-up suggestion.

**New `leadbay_prospecting_overview` prompt → Claude Code skill**: ships at `prompts/leadbay_prospecting_overview.md.tmpl` and auto-emits `SKILL.md` via the existing skills pipeline. Orients the agent to the two-entry-point workflow (discovery via `pull_leads` vs follow-up via the app's Monitor view), natural-language signal routing, the outreach loop, adaptive drafting based on connected outreach tools (Lemlist / Outreach.io / Salesloft / Apollo / HubSpot / Instantly / Attio / Amplemarket / generic), outcome-recording habit, snooze/pushback semantics, and the lens-pinning rule. Auto-triggers on Leadbay-related conversation; stays dormant otherwise.

**Composite output-shape fixes**:

- **B1 / B6 / B7 — contact `linkedin_page` is canonical and never the literal string `"null"`**: `pull_leads`, `research_lead`, `prepare_outreach`, and `get_lead_profile` all propagate `linkedin_page` on `recommended_contact` and every `contacts[]` entry, coercing the legacy `"null"` four-character string (a backend serialization bug) to real JSON null on the way out.
- **B4 — `leadbay_research_lead` outputSchema fix**: `firmographics.size` was declared as `string|null` while the composite returns `{min,max,low,high,label}`; `firmographics.location` was `string|null` while the composite returns `{city,state,country,full,pos}`; `firmographics.tags` items were `string` while the composite returns `{id,display_name,tag,score}`. All three corrected to match the actual `LeadSimplified` shape. Also tightened `social_presence` and `social_urls` declarations to typed objects (was `["object","string","null"]` etc.). The tool was unusable before this fix — every call rejected by MCP schema validation.
- **B8 — `recommended_contact_title` dropped**: this field duplicated `recommended_contact.job_title` everywhere it appeared (`pull_leads`, `research_lead`, `get_lead_profile`). Removed.
- **B12 / B15 — `leadbay_prepare_outreach` expanded `lead` block**: was a two-field stub (`{name, ai_summary, website}`); now includes `score`, `ai_agent_lead_score`, `split_ai_summary`, `location`, `size`, `phone_numbers`, `description`, `short_description`, `social_presence`, `social_urls`. The agent no longer needs a second `research_company` call to render basic context.
- **B13 — self-polling enrichment**: `enrichment.complete: boolean` added. The brief now re-fetches contacts ONCE after triggering enrichment, and exposes `complete: true` when the recommended contact has either email or phone. The agent just re-calls `leadbay_prepare_outreach(leadId)` (no `enrich`) to poll; no separate `leadbay_get_contacts` tool needed.
- **B16 — `additional_contacts_count`**: clearer name. `other_contacts_count` kept as a deprecated alias for one release.
- **B21 — recommended_contact shape standardized**: always emit the post-enrichment field shape (`contact_id`, `first_name`, `last_name`, `job_title`, `email`, `phone_number`, `linkedin_page`, `is_org_contact`) with nulls in un-enriched fields — no more shape-flipping between pre- and post-enrichment.
- **`pull_leads` augmented**: trimmed shape now includes `ai_summary`, `split_ai_summary`, `phone_numbers`, `social_presence`, `social_urls`. Agents can render rich tables without verbose mode.

**Audit budget raised**: tool description per-tool char cap raised from 3500 → 12000. The largest tool descriptions are now `leadbay_research_company` (~10.5k chars) and `leadbay_prepare_outreach` (~10.1k chars). The plan was designed knowing this cost — the new char budget is justified by what the agent now does without prompting (table layout, glyph palette, observation→suggestion menu).

**New composite `leadbay_pull_followups`** — the Monitor view (re-engagement workflow), distinct from `leadbay_pull_leads` (discovery). Wraps `GET /1.5/monitor?personal=&liked=&filtered=&count=&page=` plus `GET/POST /1.5/monitor/filter` (server-persisted FilterItem). Accepts a `set_filter: { criteria: FilterCriterion[] }` parameter that POSTs first, then re-pulls — the same store-then-apply mechanism the Leadbay app uses. The composite excludes leads with active pushback client-side (defense-in-depth — the backend likely already does this) and reports `total_excluded_by_pushback`. Status-badge derived in the rendering rule from existing fields (`epilogue_status` + `last_prospecting_action_at` + `new`) — no new backend field needed. Endpoints verified live via the discover-monitor-activate wiki page; backend handler is `MonitorRoutes.kt:getMonitor()` → `Database.monitor.findAll`.

**Two new granular tools — `leadbay_set_pushback` / `leadbay_remove_pushback`**: snooze a lead (or a bulk set, up to 1000) for 3 / 6 / 12 months. Wraps `POST /leads/pushback` and `POST /leads/remove_pushback` (mirrors the existing `/leads/epilogue` / `/leads/remove_epilogue` pattern). Accepts short labels (`"3"` / `"6"` / `"12"`) or the wire-format enum (`PUSHBACK_3` / `PUSHBACK_6` / `PUSHBACK_12`). User-facing dialogue says "snooze for N months" — never "pushback status". Pull_followups excludes leads with active pushback from its results until expiry. Available behind `LEADBAY_MCP_ADVANCED=1 + LEADBAY_MCP_WRITE=1` (granular write).

## 0.8.0 — 2026-05-15

**Prompts ship as Claude Code skills + initialize advertises the prompt catalog**: the six MCP prompts (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`) now also emit as auto-discovered Claude Code skills under `.claude-plugin/plugins/leadbay/skills/<name>/SKILL.md` from the same `.md.tmpl` source. `{{arg:NAME}}` placeholders are rewritten in-place as natural-language extraction instructions because skills have no structured-argument system. The MCP server's `initialize` response now splices a `PROMPT_CATALOG_INSTRUCTIONS` paragraph into the `instructions` payload so UI-blind clients (Cowork is the prototypical case) learn the prompt set; bullets that reference a tool gated off by the current config are suppressed (preserves the iter-12 invariant that the system prompt never names a tool the agent cannot call). Plugin manifest bumped `0.6.2` → `0.6.3`.

**Daily check-in resilience against MCP per-call timeouts and lens shifts**: a real session of `leadbay_daily_check_in` failed in three correlated ways — a blocking `leadbay_bulk_qualify_leads` hit the MCP per-call timeout, the recovery re-pull silently shifted lens and discarded the EU batch, and ten parallel `leadbay_research_lead` calls produced `"Tool permission stream closed"` backpressure that the agent treated as terminal. All three are workflow-contract gaps. New reusable snippet `packages/promptforge/snippets/heuristics/long-running-tools.md` codifies four resilience rules: pin the captured `lensId` to every subsequent call, default `wait_for_completion:false` + `qualify_status` polling for bulk ops, serialize `leadbay_research_lead` fan-out (≤3 parallel), retry transient transport errors instead of replanning. `leadbay_daily_check_in` includes the snippet, adds `PHASE 0 — RESUME CHECK` so "continue from where you left off" does not restart, pins `lensId` in Phase 2, switches Phase 3's top-up to the async pattern with `lensId`, and serializes Phase 4. Three new `failure_modes` entries enforce the rules during evals. Belt-and-suspenders paragraphs added to three composite tool descriptions (`leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead`) so ad-hoc tool use gets the same hints.

**Tests**: `packages/promptforge/test/skills.test.ts` enforces 1:1 `.md.tmpl` ↔ `SKILL.md` mapping with a byte-equal freshness gate, non-empty trigger-phrasing descriptions, no leftover `{{arg:…}}` in skill bodies, and that `PROMPT_CATALOG_INSTRUCTIONS` names every prompt with the direct-invoke fallback. `packages/mcp/test/server.test.ts` asserts default config's `instructions` mentions all six prompts and that read-only config drops `leadbay_qualify_top_n` (its description references the gated-off `leadbay_bulk_qualify_leads`).

## 0.7.1 — 2026-05-14

**Hotfix**: `packages/mcp/server.json` (the MCP Registry manifest) was still pinned at `0.6.3` and referenced `@leadbay/mcp@0.6` in three places. The 0.7.0 npm publish succeeded but the MCP Registry publish failed on a version-drift check. This release re-publishes 0.7.0's content with `server.json` bumped to `0.7.1` and the npm specifier updated to `@leadbay/mcp@0.7`. No functional change to the published package over 0.7.0.

## 0.7.0 — 2026-05-15

**Compile pipeline for prompts and tool descriptions**: every MCP prompt body and every Tool description is now authored as a `.md.tmpl` source file in the new `@leadbay/promptforge` workspace package and compiled into `prompts.generated.ts` / `tool-descriptions.generated.ts` at build time. Authors edit prose in one place; the generated TS modules are the bundle's source of inlined strings. No wire-format change: every consumer (Claude Desktop, Cursor, Claude Code, OpenClaw) sees the same MCP protocol shape — `tools/list`, `prompts/list`, `prompts/get` are unchanged. Backwards-compat: every tool name, every `inputSchema`, every annotation set, every `outputSchema` is preserved byte-for-byte. The descriptions themselves are rewritten (see below) — that is the visible change.

**PHASES + IRON LAWS + GATES in every prompt**: all 6 prompts (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_refine_audience`, `leadbay_log_outreach`, `leadbay_qualify_top_n`) restructured into explicit phases, with byproduct gates the agent must emit before progressing (`COLUMN PRESERVATION PLAN`, `DECISION LOG`, `FINAL REPORT` for file import; `STOP — awaiting user decision` for daily check-in). IRON LAW lines codify non-negotiables (no fabrication of leadIds; verification source required before `report_outreach`; top-N triage with motivational framing for `daily_check_in`).

**All 60 tool descriptions rewritten through shared snippets**: 21 composite + 37 granular + 2 file-import companion tools migrated. Each description uses shared snippet partials (`{{include:headers/tool-when-to-use}}`, `{{include:headers/tool-when-not-to-use}}`, `{{include:headers/verification-required-if-write}}` for write tools). 58 of 60 fit under 1500 chars; the two longest (`leadbay_import_leads`, `leadbay_list_mappable_fields`) retain their load-bearing detail at ~3100 chars. Audit test enforces a 3500-char per-tool budget.

**Shared snippet library**: 11 partials live in `packages/promptforge/snippets/` (iron-laws, gates, heuristics, headers). Most reusable today: `heuristics/crm-record-link.md` (extends the previous HubSpot guidance to Salesforce, Pipedrive, Close, Attio with per-CRM `url_template` examples for EXTERNAL_ID custom fields) and `heuristics/consumer-email-domains.md` with the explicit "domain extraction is a key factor of match success" framing.

**Daily check-in prompt overhaul** (per user direction): triage scope widened from top-3 to **top-10**, preferring leads with a fresh `ai_agent_lead_score`; each summary now framed motivationally ("why prospecting this lead today might be a good idea"); auto-top-up via `leadbay_bulk_qualify_leads` when the batch is short; PHASE 4 now researches **every** promising lead and surfaces the recommended contacts; the agent ASKS the user before consuming contact-enrichment quota.

**Import-file prompt overhaul** (per user direction): explicit GOAL section at the top — the job is to maximize how many rows the Leadbay system can ingest and match. Two deliverables named: max-coverage column mapping + the user's original file augmented with a `LEADBAY_ID` column populated for confidently disambiguated rows. WHAT GOOD LOOKS LIKE section teaches the disambiguation bar positively; the "never pick from score alone..." guardrail remains as a hard rule.

**Test framework spine** (`packages/mcp/test/eval/`): full eval harness landed. Drives scripted Claude sessions against the in-process MCP Server, captures L1+L2+L3 Evidence (tool calls, transcript, invariants, judge scores), runs a mission-match judge that reads its rubric from the prompt's frontmatter, enforces an Evidence-pyramid completeness rule, supports atomic partial saves to `.context/evals/<run-id>.json`, computes budget-regression flags, ships a worktree-based drift detector for main-vs-branch comparison, and includes a tool-routing classifier eval with 70+ (intent → expected_tool) fixtures. Gated by `EVAL=1`; default `pnpm test` ignores it. Replay-by-default for backend HTTP (`EVAL_RECORD=1` opt-in) keeps the user's Leadbay quota safe by construction.

**Audit tests** (`packages/mcp/test/audit/`): five new T0 meta-properties enforced on every commit — every prompt has eval coverage, tool descriptions imported (never inline in `server.ts`), per-tool char budget, `leadbay_<verb>_<noun>` naming convention, snippet orphans + dead `{{include:...}}` refs. Snapshot regression test catches accidental prose loss in migrated prompts.

**Agentic file import prep** (carryover entry — work landed in the merged 0.6.4 PR but never got a published changelog entry; rolled forward here): `leadbay_resolve_import_rows` — a read-only resolver that calls the backend `/leads/resolve` endpoint for messy CSV-shaped rows, returns matched/ambiguous/unresolved candidates, can hydrate ambiguous candidates with active-lens profile facts, and emits `records_for_import` plus safe identity-only `mappings_for_import` for `leadbay_import_leads` / `leadbay_import_and_qualify`. Import mappings accept `LEADBAY_ID`, `CRM_ID`, and `SIREN` as resolver fields.

## 0.6.3 — 2026-05-12

**Async import schema fix**: `leadbay_import_leads` now declares both its legacy blocking result shape and its async kickoff shape (`{status: "running", handle_id, importIds, progress}`) in `outputSchema`, so Claude Desktop and other MCP SDK clients accept the fast handle response instead of rejecting `structuredContent`.

**Async qualification schema fix**: `leadbay_bulk_qualify_leads` now also declares its async kickoff shape (`{status: "running", handle_id, qualify_id, ...}`), matching the `wait_for_completion:false` behavior added for short MCP client transport timeouts.

## 0.6.2 — 2026-05-12

**MCPB install fix**: desktop extension bundles now use the current `manifest_version` field and remove unsupported manifest keys (`user_config.*.enum` and an internal note field) so Claude Desktop can preview and install the MCPB.

## 0.6.1 — 2026-05-10

**Distribution**: listed in the official MCP Registry as `io.github.leadbay/leadbay-mcp` (auto-published from CI via GitHub OIDC); installable as a Claude Code plugin via `/plugin marketplace add leadbay/leadclaw` then `/plugin install leadbay@leadbay-leadclaw`; submission packets prepared for the Claude.ai connector directory and Anthropic's curated MCPB extension directory.

**Registry verification**: adds `mcpName` to the npm package metadata so the MCP Registry can verify ownership of `io.github.leadbay/leadbay-mcp` against the published `@leadbay/mcp` package.

## 0.6.0 — 2026-05-08

Massive spec-coverage upgrade. Each tool declares **annotations** (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`); 17 composites + 12 highest-leverage granulars declare typed `outputSchema` + emit `structuredContent`. New surfaces: `prompts/*` (5 canned slash-commands), `resources/*` (`lead://`, `lens://`, `org://taste-profile`), `notifications/progress` (per-lead streaming on every long-running composite), `notifications/cancelled` → `ToolContext.signal` (bulk-store entries marked `cancelled` so subsequent status polls return `BULK_CANCELLED`), `elicitation/create` (refine_prompt clarification + report_outreach user_confirmed anti-poisoning).

**Hardening**: every `inputSchema` declares `additionalProperties: false`. Runtime conformance test pins `structuredContent` against `outputSchema` for every declarer (drift-catcher). Static-scan audit of every error-hint string asserts each names a recovery action. `report_outreach.verification` rejects extra keys at runtime (closes the SDK's nested-additionalProperties limitation). `score_0_to_10` deprecated alias of `boost_score` removed in 0.7.0.

**Token economy**: pagination payloads carry `has_more` + `next_page`. `research_lead` truncates large payloads with a `truncation_hint`. Per-tool opt-in `response_format: "json" | "markdown"` lets chat-rendering agents pick the cheaper render (research_lead first; pattern reusable). `LEADBAY_DEBUG=1` enables a per-tools/call observability line on stderr.

**DXT → MCPB**: bundle now publishes both `leadbay-X.Y.Z.dxt` (legacy) and `leadbay-X.Y.Z.mcpb` (new Claude Desktop format) for one cycle. Manifest `dxt_version` field stays for backwards-compat with current installers; field rename will follow Anthropic's spec when finalised. The two filenames have identical content; downstream installers can match either glob.

**Versioning + docs**: 0.4.0 / 0.6.0 bumps; README §3a "Spec primitives in action" adds wire-level JSON-RPC transcripts for every primitive; MIGRATION.md 0.5 → 0.6 walkthrough.

## 0.5.0 — 2026-05-04

### `leadbay_import_and_qualify` — new composite

End-to-end import + AI qualification in one call. Wraps `leadbay_import_leads` (chunking, mapping preflight, custom-field validation), then fans out `web_fetch` on every imported leadId, polls until each lead's qualification answers populate, and returns the results. When the wall-clock budget overflows, returns a `qualify_id` UUID handle for resumable retrieval via the new `leadbay_qualify_status` tool.

**Inputs** (mostly mirrors `leadbay_import_leads`):

- `domains` OR `records` — same shape as import_leads.
- `mappings.fields` and `mappings.custom_fields` — same as 0.3.0 import_leads. Custom fields surface as first-class via `leadbay_list_mappable_fields` (also new).
- `dry_run: "preview"` — special mode: uploads the CSV in dry-run and returns the wizard's per-column AI mapping hints + sample rows + custom-field candidates from the org catalog matched against unmapped column names by exact / case-insensitive / fuzzy-substring. NO ai_rescore quota consumed.
- `total_budget_ms` (default 900_000 = 15 min), `per_lead_budget_ms` (default 90_000), `per_phase_budget_ms` (default 300_000).
- `skip_already_qualified` (default `true`) — skips `web_fetch` launch on leads with a non-null `ai_agent_lead_score`. Saves quota.

**Outputs** (full mode):

```
{
  kind: "result",
  qualify_id: "<UUIDv4>" | null,
  import_ids: [...],
  imported: [{ leadId, domain?, name, rowId? }],
  not_imported: [...],
  qualified: [{ lead_id, qualifications: [{ question, score, response, computed_at }], qualification_summary, signals_count, ... }],
  still_running: [{ lead_id }],
  failed: [...],
  quota_exceeded: bool,
  skipped_already_qualified: [...],
  reused?: bool, seconds_since_original?: number,
  cancelled?: bool, budget_exhausted?: bool,
  region, _meta
}
```

`qualify_id` is persisted to `~/.leadbay/bulks.json` (30-day TTL, 5-min idempotency window) — same store as `leadbay_enrich_titles` but with a `kind: "qualify"` discriminator. Re-calling with the same records+mapping within 5 min returns the same handle (`reused: true`).

### `leadbay_qualify_status` — new resumable retrieval

```
leadbay_qualify_status({ qualify_id })
  → { qualify_id, status, lead_ids, qualified, still_running, ... }
```

Refreshes the per-lead state (`/web_fetch` + `/ai_agent_responses`) at call time. No backend mutation. Survives MCP restart.

### `leadbay_list_mappable_fields` — new discovery

```
leadbay_list_mappable_fields()
  → { standard_fields: [{name, description, mapping_value}], custom_fields: [{id, name, type, description, mapping_value}], region, _meta }
```

Lists every CRM field the agent can target in `mappings.fields`. Standard fields come from a static catalog with human descriptions; custom fields come from `GET /crm/custom_fields`. The `mapping_value` field is what the agent passes verbatim (e.g., `"CUSTOM.8"`).

### `leadbay_import_leads` 0.3.0 — `mappings.custom_fields` shorthand

In 0.2.0 the only way to map a custom field was `mappings.fields[col] = "CUSTOM.<id>"` (raw wire format). 0.3.0 adds `mappings.custom_fields[col] = <id>` (numeric) or `<name>` (string), resolved against `/crm/custom_fields` before the wizard sees it. New error codes: `IMPORT_CUSTOM_FIELD_UNKNOWN`, `IMPORT_INVALID_CUSTOM_MAPPING`, `IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS`, `IMPORT_CUSTOM_FIELD_CATALOG_REQUIRED`, `IMPORT_MAPPING_DUPLICATE_CUSTOM`. Catalog GET is suppressed when the mapping references no custom fields (saves a round trip).

### Bulk store schema widening

`BulkRecord` now has a `kind: "enrich" | "qualify"` discriminator. Old enrich rows (no `kind` field) default to `"enrich"` on read. Existing `leadbay_bulk_enrich_status` callers see no change. Cross-kind id queries are surfaced with the new `BULK_WRONG_KIND` error code that points the caller at the right tool.

### `not_in_lens` partition — terminate the silent infinite-poll

Both `leadbay_import_and_qualify` and `leadbay_qualify_status` now surface a `not_in_lens: string[]` array — lead ids that exist in the org (the wizard imported them) but are NOT admitted to the active lens. The backend's `queueAiRescoreForLead` is a no-op for these leads — they will never appear in `qualified[]`. Surfacing them in a distinct partition means the agent's poll loop terminates.

Discovered by iter-17 live e2e: imported 4 leads (Apple, Stripe, Datadog, GitHub) into a lens whose scoring rules only admitted Datadog. Datadog got `ai_agent_lead_score: -13` + 3/3 qualifications cleanly; Apple and Stripe sat in `still_running[]` indefinitely with no signal to stop polling. Now they land in `not_in_lens` with an actionable agent prompt: "either change the active lens or accept the lead won't be qualified."

`qualify_status` re-checks lens membership at each call — a lead added to the lens after the original `import_and_qualify` automatically migrates from `not_in_lens` back into the regular qualify pipeline on the next status call.

### Aligned with backend `/imports/{id}/leads` (PR #1801)

`leadbay_import_and_qualify` now sources the qualify-phase lead set from `GET /1.5/imports/{importId}/leads` (added backend-side 2026-05-06). This is the spec-prescribed source of truth — distinct lead ids the import touched (matched-existing AND newly-created). Replaces the per-record reconciliation pagination for the qualify input. Falls back gracefully to the per-record set when the endpoint is unavailable (older backend / 400 in_progress race).

Verified live: import 970bd47a-… (apple.com matched, salesforce.com uncrawled) → /leads returned `{lead_ids: [0a788a89-...]}` cleanly; qualify_id 08ad4555-… retrieved end-to-end.

### Monitor-membership disclosure

Both `leadbay_import_leads` and `leadbay_import_and_qualify` now flag in their tool descriptions that imported leads are NOT auto-promoted to the user's Monitor tab. Lens-scoring rules decide — only above-threshold leads get `in_monitor: true`. This was a real surprise discovered in production (journal entry `leadbay-monitor-lens-filter`, captured 2026-05-05). Surfacing it in the description prevents the agent from telling users "I imported your leads, check Monitor" — answer is the CRM-imports list, not Monitor.

### Stable qualification ordering + human_summary

Both `leadbay_import_and_qualify` and `leadbay_qualify_status` now sort `qualifications[]` by the org's `ai_agent_questions` catalog order — the same question appears at the same index across calls so LLM agents can position-index reliably. Catalog comes from `client.resolveTasteProfile()` (cached 10min). Falls back to alphabetical when the catalog is empty.

Each `qualified[]` entry also carries an optional `human_summary` string of the form `answered X/Y — <signal> on '<question>'[, <signal> on '<question>']` where `<signal>` is `strong positive` (score=20), `positive` (10), `neutral` (0), or `negative` (-10). Top-2 by absolute score. Saves the agent from reading every per-question response when it just needs the gist.

## 0.4.0 — 2026-05-04

### `leadbay_import_leads` 0.2.0 — custom field mapping

The MCP tool now drives the same CRM-import wizard the web UI exposes — pass arbitrary CSV-shaped records and tell Leadbay which column maps to which `StandardCrmFieldType`.

**Two modes** (pass exactly one of `domains` / `records`):

- **Mode A (existing, unchanged):** `domains: [{domain, name?}]` — synthesizes a 2-column CSV (LEAD_NAME, LEAD_WEBSITE) and uses the default mapping. Output shape is identical to 0.1.x: `{ leads: [{domain, leadId, name}], not_imported: [{domain, reason}], ... }`.
- **Mode B (new):** `records: [{Col1, Col2, ...}]` plus `mappings: { fields: { Col1: "LEAD_NAME", Col2: "LEAD_WEBSITE", Col3: "LEAD_SECTOR", ... } }`. The tool synthesizes a CSV from the union of record keys (sorted, deterministic) and POSTs the caller-supplied mapping to `/imports/{id}/update_mappings`. Output shape: `{ leads: [{rowId, domain?, leadId, name}], not_imported: [{rowId, domain?, reason}], ... }`. `rowId` round-trips your input row order; `domain` populated only when `LEAD_WEBSITE` was mapped and the value parsed.

Mappings.fields must include `LEAD_NAME` or `LEAD_WEBSITE` — the wizard's resolver needs at least one of those to find a lead. Other CRM fields (`LEAD_SECTOR`, `LEAD_LOCATION`, `LEAD_SIZE`, `EMAIL`, `CRM_ID`, `LEADBAY_ID`, `DEAL_CRM_ID`, `CONTACT_TITLE`, `LEAD_STATUS`, `LEAD_STATUS_DATE`) are passed through verbatim.

**Validation (records mode):** new typed error codes — `IMPORT_INPUT_CONFLICT` (both modes supplied), `IMPORT_MAPPING_REQUIRED` (no mappings.fields), `IMPORT_MAPPING_NO_RESOLVER` (no LEAD_NAME or LEAD_WEBSITE in mapping), `IMPORT_MAPPING_KEY_UNKNOWN` (mapping key absent from records), `IMPORT_RESERVED_COLUMN` (record or mapping key matches `MCP_ROW_ID` case-insensitively), `IMPORT_INVALID_COLUMN_NAME` (column name >128 chars or contains control chars), `IMPORT_INVALID_CELL_TYPE` (cell value is array/object — coerce to string before passing). null/undefined cells coerce to "", numbers/booleans coerce via `String(v)`.

**Security:** user-supplied column names now flow through the same `escapeCsvCell` (RFC 4180 quoting + formula-injection prefix) that data values use. Header injection vectors (`=`, `+`, `-`, `@`, `,`, `"`, newline) are neutered.

**Backward compat:** Mode A output shape unchanged — the new `rowId` field is records-mode only. Existing `domains: [...]` callers see no diff.

## 0.3.0 — 2026-04-29

Behavior-changing release: closes [product#3504](https://github.com/leadbay/product/issues/3504) end-to-end. Default-installed MCP server now matches its own system prompt out of the box, the `login` command never lands a bearer token in scrollback by default, and `claude mcp add` registers Leadbay at user scope so it's visible from any project.

### Coverage — composite write tools default ON

- **`LEADBAY_MCP_WRITE` default is now `"1"` (ON).** The composite write tools (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_answer_clarification`, `leadbay_import_leads`) are exposed by default. Set `LEADBAY_MCP_WRITE=0` (or `--no-write` on `install`) to disable them.
- **`SERVER_INSTRUCTIONS` is now dynamic.** The system prompt sent to MCP clients references only the tools actually registered on this instance. Read-only-mode agents receive a different prompt that omits the verification mandate and tells the agent to ask the user to enable writes if they request a config-mutating action.
- **`leadbay-mcp install --include-write` is a no-op (deprecated).** Writes are on by default. Pass `--no-write` for the inverse. The deprecation warning prints **before** the password prompt so it's not buried.
- **`LEADBAY_MCP_WRITE` value-vocabulary expanded.** In 0.2.x only `"1"` was ON; `"true"` / `"yes"` / `"on"` were treated as OFF. In 0.3.0 the parser accepts all of those as ON, and `"0"` / `"false"` / `"no"` / `"off"` as OFF. Unrecognized values default to ON with a one-shot stderr warning. **Existing operators using `=true` / `=yes` / `=on` will see writes flip ON.** See [MIGRATION.md](./MIGRATION.md).

### Login — no token in stdout

- **`leadbay-mcp login` default writes a 0600-mode credentials file.** The path resolves to `$XDG_CONFIG_HOME/leadbay/credentials.json` if set, else `~/Library/Application Support/leadbay/credentials.json` on macOS, `%APPDATA%\leadbay\credentials.json` on Windows, else `~/.config/leadbay/credentials.json`. Existing `~/.leadbay-mcp.json` files (0.2.x) are still honored on this run with a deprecation note pointing at the new path (no automatic file move).
- **`--unsafe-print-token`** restores the previous "print JSON config to stdout" behavior. The deprecated `--print-token` alias still works for one release with a deprecation warning.
- **Collision detection** — if the target credentials file already exists with a different `LEADBAY_TOKEN` or `LEADBAY_REGION`, `login` refuses without `--force` and tells the operator how to keep both files.
- **EACCES / EROFS / ENOENT** errors on the file write print actionable remediation pointing at `--write-config /tmp/...` or `--unsafe-print-token`.

### Scope — visible from any project

- **`leadbay-mcp install` now passes `--scope user` to `claude mcp add`.** This was Ludo's third complaint in #3504: the default `claude mcp add` is project-local, so a freshly-opened conversation from a different directory can't see the server. README §2 (Claude Code), §1 (install), and §4 (troubleshooting table) all reflect the user-scope recommendation.

### Migration

- Read [MIGRATION.md](./MIGRATION.md) for the value-vocabulary flip, the login default, and the install scope change.
- The legacy DXT manifest key (`leadbay_mcp_write`) is unchanged in shape — it now defaults `true` (ON) and feeds the same `LEADBAY_MCP_WRITE` env var. Users who explicitly set the toggle to `false` keep their read-only behavior; users who never touched it (the bug case Ludo hit) now get the new default ON.
- Tests: dropped the `SERVER_INSTRUCTIONS` const re-export. Tests now exercise `buildServerInstructions(exposedSet)` directly across the default/read-only/advanced matrices. New unit suites: `parse-write-env.test.ts`, `login-default.test.ts`, `install-flags.test.ts`.

### Known follow-up (0.4.0)

- `compositeWriteTools` will split into safer-tier (credit-spending: bulk_qualify_leads, enrich_titles, report_outreach, answer_clarification) and config-mutating-tier (refine_prompt, adjust_audience, import_leads), with audit-log + one-click undo on the config-mutating side. Tracked separately.

## 0.2.5 — 2026-04-28

New `leadbay_import_leads` composite write tool.

- **New tool: [`leadbay_import_leads`](https://github.com/leadbay/product/issues/3537)** — accepts a list of `{ domain, name? }` and returns Leadbay `leadId`s for the ones the crawler already knows. Output is naturally chainable into `leadbay_bulk_qualify_leads({ leadIds })` and `leadbay_research_lead`. Gated behind `LEADBAY_MCP_WRITE=1` (MCP) and `exposeWrite=true` (OpenClaw).

  **⚠️ Writes user state.** Internally wraps Leadbay's CRM-import wizard (the only domain-import primitive the backend ships today). Each call:
    - creates a row in the user's CRM-imports list (visible in the web UI)
    - touches onboarding state (`startFileless`, onboarding step → PROCESSING)

  Suitable for occasional automation. **Not** suitable for high-cadence (>5 calls/day) — the right primitive is a clean async-import-with-crawl backend endpoint, tracked as a follow-up issue (`leadbay/backend` — prolonged async import jobs).

  **Surface:**
  - Input: `{ domains: [{domain, name?}], dry_run?: boolean, per_phase_budget_ms?, total_budget_ms? }`.
  - Output: `{ leads: [{domain, leadId, name}], not_imported: [{domain, reason}], importIds, region, _meta }` where `reason ∈ malformed | no_match | uncrawled | ambiguous | internal_error | dry_run`.
  - `dry_run: true` runs preprocess only — skips the lead-CRM linking. The CRM-imports row still appears (the wedge can't fully eliminate it without backend changes), but the heavier side effect of committing matches is skipped.
  - 8 typed error codes (`IMPORT_PREPROCESS_FAILED`, `IMPORT_PROCESSING_FAILED`, `IMPORT_BUDGET_EXHAUSTED`, `IMPORT_NOT_TERMINAL`, `IMPORT_ADMIN_REQUIRED`, `IMPORT_BILLING_REQUIRED`, `IMPORT_PAGINATION_RUNAWAY`, `IMPORT_EMPTY_INPUT`) — every one carries `{ code, message, hint }`. Per-domain `not_imported.reason="internal_error"` covers irreconcilable rows from the wizard.

  **Limitations (v1):** uncrawled domains land in `not_imported` with `reason: "uncrawled"` — the tool does NOT create new Leadbay leads for unknown websites; the caller decides what to do. The backend follow-up will lift this.

  **Implementation notes:** preflight admin check (fails in <500ms instead of after a 30s wizard timeout), MCP_ROW_ID-based reconciliation (resilient to wizard URL canonicalization), client-side chunking at 100 domains per CSV upload, stabilization loop after `processing.finished` to avoid races where some records are still in `MATCHING|IMPORTING`, RFC 4180 quoting + formula-injection (`=`/`+`/`-`/`@`) prefix on every cell, AbortSignal plumbing returns `{cancelled: true, importIds, ...}` so callers can recover. New helper `LeadbayClient.requestRawBinary()` for the CSV upload — mirrors `request()` exactly (auth, semaphore, error mapping, `_lastMeta`, `LEADBAY_MOCK=1` mock-mode parity).

- **README**: new `## Write tools (LEADBAY_MCP_WRITE=1)` section with the import quickstart.

## 0.2.4 — 2026-04-22

Claude Desktop 2026 compatibility + install UX polish. Also publishes the `refine_prompt` `/user_prompt` wire-key fix that landed on `main` in 0.2.3 but never reached npm.

- **Fix [product#3504](https://github.com/leadbay/product/issues/3504)** — `install --target claude-desktop` no longer silently no-ops on Claude Desktop 2026. The app moved to the DXT (Desktop Extension) system; the legacy `claude_desktop_config.json` is UI-prefs-only there and gets overwritten on every prefs save, so a block written to it disappears a few minutes later. `install` now detects DXT (via `Claude Extensions/`, `extensions-installations.json`, or `dxt:*` keys in `config.json`), prints a loud warning pointing at the `.dxt` bundle, and default-skips the legacy write. Pass `--force-legacy` to override.
- **New: shipping a `.dxt` bundle** — drag-drop into Claude Desktop 2026 → Settings → Extensions. Uploaded to each [GitHub Release](https://github.com/leadbay/leadclaw/releases). Dialog asks for token + region + write-toggle; no terminal required. Manifest is DXT 0.2 (`dxt_version: "0.2"`, `user_config.leadbay_token.sensitive: true`). Source for the build lives in `packages/dxt/`.
- **Fix**: `login` 401 errors no longer end with a dangling `:` when the backend returns an empty body. Messages now read `login failed (401) at <url> (wrong email or password?)`. 429/5xx get their own hints too. The core helper `formatLoginError` is exported from `@leadbay/core` so the MCP and ClawHub surfaces stay in sync.
- **README**: new section on `npm install -g` EACCES (sudo / npx / nvm workarounds — common on the official nodejs.org `.pkg`), and a pointer to the `.dxt` install for Claude Desktop 2026.
- **Also shipping** (previously merged but not yet published to npm) — `leadbay_refine_prompt` / `leadbay_set_user_prompt` now send `{ user_prompt }` instead of `{ prompt }` to `POST /user_prompt` ([product#3508](https://github.com/leadbay/product/issues/3508)). Fixes the JSON deserialization 400 Ludo hit during the 0.2.2 install session.

## 0.2.3 — 2026-04-21

Bug fix release.

- **Fix [product#3508](https://github.com/leadbay/product/issues/3508)**: `leadbay_refine_prompt` (and the granular `leadbay_set_user_prompt`) now send the correct `{ user_prompt }` body key to `POST /organizations/{orgId}/user_prompt`. Previous versions sent `{ prompt }`, which the backend's strict kotlinx.serialization rejected with a JSON deserialization error (400). The `dry_run` preview for both tools was printing the wrong shape too, which hid the mismatch from anyone inspecting it. New unit tests pin the wire key so this contract can't silently regress again.

## 0.2.2 — 2026-04-21

Bug fix + contract correction + mental-model docs release.

- **Fix [product#3504](https://github.com/leadbay/product/issues/3504)**: `npx -y @leadbay/mcp` no longer exits silently on Node 25. The `isEntrypoint` check now resolves both sides through `realpathSync`, so the npx shim symlink path matches the real `dist/bin.js`. Previously `main()` never ran under npx and the MCP host saw a dead connection with no diagnostic.
- Replaced stale `app.leadbay.ai` URLs in error strings (NOT_AUTHENTICATED, AUTH_INVALID, BILLING_SUSPENDED, PERMISSION_DENIED) and CLI help text with runnable commands (`leadbay-mcp install`, `leadbay-mcp login`) or "contact support". Recovery hints include `--region <us|fr>` because the CLI refuses without it (anti-cross-region credential-leak guard).
- Renamed misleading `avg_score_0_to_10` field on `pull_leads` / `bulk_qualify_leads` qualification summaries to `avg_qualification_boost`. Per-question AI agent scores are discrete boosts (-10/0/10/20), not 0-10 averages — interface JSDoc now reflects the real contract.
- `SERVER_INSTRUCTIONS` gains three new paragraphs: "How Leadbay works" (inbox + consumption-based pacing), "Two scoring layers" (basic `score` vs AI-qualified top ~10 with `ai_agent_lead_score`), and "Suggested rhythm" (daily check-in + host-agnostic scheduling hint).
- `leadbay_pull_leads`, `leadbay_research_lead`, `leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, and `leadbay_account_status` descriptions updated to reinforce the same model so the agent sees it at both top level and per-tool.
- New regression test `test/smoke/npx-entrypoint.test.ts` guards the symlink invocation path. New non-regression test asserts the inbox/pace/scoring/daily language stays in `SERVER_INSTRUCTIONS`.
- Live smoke harness extended with composite-level checks + (optional) thinking-model judge that writes a redacted report to `.context/`.

## 0.2.1 — 2026-04-21

Docs-only release.

- Removed the stale "pre-release — not yet on npm" banner that was packed into 0.2.0.
- Removed the §1.1 "install from source" section (covered the pre-publish case; obsolete now that 0.2.0 is live).
- §7 "For maintainers" replaced with a short pointer to the new `RELEASE.md` runbook.
- First release carrying signed sigstore provenance (repo is now public).

## 0.2.0 — 2026-04-20

First public npm release.

- Agent-optimized composite tool surface (pull_leads, research_lead, bulk_qualify_leads, enrich_titles, adjust_audience, refine_prompt, recall_ordered_titles, account_status, report_outreach).
- `leadbay-mcp install` one-shot setup: mints a token and registers the server with Claude Code, Claude Desktop, and Cursor.
- `leadbay-mcp login` lower-level token mint (`--write-config` drops a 0600 JSON).
- `leadbay-mcp doctor` validates token + region + quota.
- Gating: `LEADBAY_MCP_WRITE=1` for mutations, `LEADBAY_MCP_ADVANCED=1` for the granular API surface (both off by default).
- `report_outreach` requires a verification field (`gmail_message_id | calendar_event_id | user_confirmed`) to prevent pipeline poisoning.
- Mock mode via `LEADBAY_MOCK=1` for agent-author dry-running against `.context/leadbay-live-shapes/` fixtures.
- Tag-driven CI publish via `.github/workflows/release.yml` (push `mcp-v<version>` or `v<version>`).
- `--version` output now sourced from `package.json` at build time — no more drift between the tarball version and the binary's self-reported version.
