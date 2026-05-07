# Migration: leadbay-mcp 0.2.x → 0.3.0

This release fixes [product#3504](https://github.com/leadbay/product/issues/3504): the default-installed MCP server's system prompt told the agent to call tools that the server didn't actually expose. Three behavior changes you need to know about.

## 1. `LEADBAY_MCP_WRITE` defaults to ON

In 0.2.x the composite write tools (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_answer_clarification`, `leadbay_import_leads`) were gated behind `LEADBAY_MCP_WRITE=1`. The `SERVER_INSTRUCTIONS` referenced them anyway → users got an agent system prompt that lied about what was available.

**0.3.0**: `LEADBAY_MCP_WRITE` defaults to `"1"` (ON). The system prompt is built from the actual exposed tool set, so it stops lying. To restore the previous read-only behavior, set `LEADBAY_MCP_WRITE=0` (or `--no-write` on `leadbay-mcp install`).

### Value-vocabulary flip

In 0.2.x the parser was strict: only `LEADBAY_MCP_WRITE === "1"` turned writes on. So `=true`, `=yes`, `=on` were treated as OFF (probably accidentally — the user clearly meant "on"). The 0.3.0 parser accepts all of these as ON:

| Value | 0.2.x meaning | 0.3.0 meaning |
|---|---|---|
| unset | OFF | **ON** |
| `""` | OFF | **ON** |
| `"1"` / `"true"` / `"yes"` / `"on"` | OFF (only `"1"`) / OFF (the rest) | **ON** |
| `"0"` / `"false"` / `"no"` / `"off"` | OFF | OFF |
| anything else | OFF | ON + stderr warning |

If you were relying on `LEADBAY_MCP_WRITE=true` to mean OFF (unlikely but possible), switch to `LEADBAY_MCP_WRITE=0`.

## 2. `leadbay-mcp login` no longer prints the token to stdout

In 0.2.x `login` printed the bearer token (inside an MCP-config JSON blob) to stdout by default, with a stderr warning. Real users (Ludo's incident) had tokens leak into terminal scrollback / agent chat / CI logs.

**0.3.0**: `login` writes a `0600`-mode credentials file by default. The path resolves per-platform:

| Platform | Default path |
|---|---|
| Linux (or anywhere `XDG_CONFIG_HOME` is set) | `$XDG_CONFIG_HOME/leadbay/credentials.json` (or `~/.config/leadbay/credentials.json`) |
| macOS | `~/Library/Application Support/leadbay/credentials.json` |
| Windows | `%APPDATA%\leadbay\credentials.json` |

If `~/.leadbay-mcp.json` (the 0.2.x default) already exists, `login` writes to that path with a one-shot deprecation note pointing at the new location.

### `--unsafe-print-token` (legacy CI use)

Pass `--unsafe-print-token` to restore the old "print to stdout" behavior. The deprecated `--print-token` alias still works for one release with a warning. Use only if you have to — the token will end up in scrollback / logs.

### Collision detection

If the target file already exists with a different `LEADBAY_TOKEN` or `LEADBAY_REGION`, `login` refuses without `--force` and tells you how to keep both files. Toggling between accounts no longer silently overwrites the prior token.

### File-write errors

`EACCES` / `EROFS` / `ENOENT` print actionable remediation pointing at `--write-config /tmp/...` or `--unsafe-print-token`.

## 3. `leadbay-mcp install` registers Claude Code at `--scope user`

Previously `claude mcp add leadbay …` defaulted to project-local scope, so opening Claude Code from a different directory made Leadbay invisible. Ludo's #3504 third complaint.

**0.3.0**: `install` injects `--scope user` into the `claude mcp add` argv. New installs are visible from any project.

If you have a 0.2.x project-scope install and want to upgrade to user scope, run:
```bash
claude mcp remove leadbay
npx -y @leadbay/mcp@0.3 install --email you@yourcompany.com --region us
```
Or do it manually:
```bash
claude mcp add leadbay --scope user --env LEADBAY_TOKEN=<token> --env LEADBAY_REGION=us -- npx -y @leadbay/mcp@0.3
```

## 4. `--include-write` is a no-op

The legacy `leadbay-mcp install --include-write` flag is accepted but a no-op — writes are on by default in 0.3.0. The deprecation warning prints **before** the password prompt so users see it.

---

# Migration: leadclaw / leadbay-mcp 0.1.x → 0.2.0

This release is the autoplan-reviewed agent-experience overhaul. The OpenClaw
plugin and MCP server gain a coherent composite-tool surface so an AI agent
can drive Leadbay end-to-end with a handful of calls. The old granular tools
remain available behind config flags.

## Headline changes

- **`leadbay_find_prospects` removed** → replaced by **`leadbay_pull_leads`**
  (richer return: each lead carries a `qualification_summary` digest from
  `ai_agent_responses`, plus all the engagement-state flags).
- **New composite agent surface** (the agent's default toolbox):
  - `leadbay_pull_leads` — paginated wishlist with qualification digest
  - `leadbay_research_lead` — full lead detail (qualification → signals → firmographics → contacts → engagement)
  - `leadbay_recall_ordered_titles` — show titles previously enriched
  - `leadbay_account_status` — admin / language / quota / intelligence state
  - `leadbay_bulk_qualify_leads` — paginate past already-qualified, fan-out + poll
  - `leadbay_enrich_titles` — selection-lifecycle-managed bulk enrichment
  - `leadbay_adjust_audience` — sector / size filter mutation with permission auto-routing
  - `leadbay_refine_prompt` — set the org intelligence-refinement prompt
  - `leadbay_answer_clarification` — answer the question Leadbay raised
  - `leadbay_report_outreach` — log outreach **with mandatory verification**
- **New gating model** (both MCP and OpenClaw):
  - **Composite reads**: always exposed.
  - **Composite writes**: gated by `LEADBAY_MCP_WRITE=1` (MCP) or
    `exposeWrite: true` plugin config (OpenClaw).
  - **Granular reads**: gated by `LEADBAY_MCP_ADVANCED=1` (MCP) or
    `exposeGranular: true` (OpenClaw).
  - **Granular writes**: gated by BOTH advanced AND write flags.
- **`leadbay_login` auto-detects region** (us → fr fallback). The user no
  longer needs to know which backend their account is in.
- **`leadbay_get_quota` switched to the live `/quota_status` endpoint** —
  returns daily/weekly/monthly windows for `llm_completion`, `ai_rescore`,
  `web_fetch` resources. Use this AFTER a 429 to explain which window was hit.
- **Error mapping changed: `429 → QUOTA_EXCEEDED`** (production behavior).
  Legacy 402 still maps to QUOTA_EXCEEDED for back-compat.
- **HTTP-response headers are now captured** and propagated through the error
  envelope's `_meta: {region, endpoint, latency_ms, retry_after}`. There is
  no `X-Request-Id` header on the Leadbay backend — we don't pretend there is.
- **`LEADBAY_MOCK=1`** mode: serve responses from on-disk fixtures
  (`.context/leadbay-live-shapes/`) for agent-author dry-running. Writes are
  journaled in-process and return `{mocked: true, would_call: {...}}`.
- **`dry_run: true`** param on every state-changing composite (`report_outreach`,
  `set_user_prompt`, `update_lens_filter`, `launch_bulk_enrichment`, etc.) —
  returns the would-call envelope without contacting the backend.

## report_outreach: verification REQUIRED

The autoplan review (CEO + Eng + DX voices) flagged that allowing the agent
to self-report outreach without proof would poison the SDR pipeline. The user
chose the strictest mitigation: every `report_outreach` call MUST include a
`verification` field:

```json
{
  "lead_id": "abc-123",
  "note": "Sent intro email to CTO citing Hornsea 3 contract",
  "epilogue_status": "STILL_CHASING",
  "verification": {
    "source": "gmail_message_id",
    "ref": "<the message id from Gmail>"
  }
}
```

Valid `source` values:
- `gmail_message_id` — message id returned by `mcp__claude_ai_Gmail__send_email`
- `calendar_event_id` — event id from a calendar booking tool
- `user_confirmed` — `ref` is the user's literal confirmation in chat

The verification is appended to the note body so humans in the Leadbay UI can
see the proof. Calls without verification return `VERIFICATION_REQUIRED`.

## Side-by-side: old flow → new flow

| Old (v0.1) | New (v0.2) | Notes |
|---|---|---|
| `leadbay_find_prospects` | `leadbay_pull_leads` | Same intent; richer return; remove name |
| `leadbay_get_lead_profile` | `leadbay_research_lead` | New ordering (qualification first); reshapes `web_fetch.content` from emoji-keyed dict to ordered array. Granular still available behind exposeGranular. |
| `leadbay_research_company` | unchanged | Kept for back-compat; prefer `research_lead` when you have the id. |
| `leadbay_qualify_lead` (single) | `leadbay_bulk_qualify_leads` | Composite paginates past already-qualified, fan-outs, polls, bails on 429. Granular still available. |
| `leadbay_enrich_contacts` (single) | `leadbay_enrich_titles` | Composite manages selection lifecycle. Granular still available. |
| `leadbay_get_quota` (legacy billing fields) | `leadbay_get_quota` (live /quota_status) | Same name, new shape. Old `freemium.daily_quota` / `ai_credits` are defunct. |
| Add a free-form note via `leadbay_add_note` | Log outreach via `leadbay_report_outreach` | Note tool still exists for free-form context; `report_outreach` is the right call after an actual action. |

## How to upgrade

### Claude Desktop / Cursor (MCP)

```json
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.2"],
      "env": {
        "LEADBAY_TOKEN": "lb_...",
        "LEADBAY_MCP_WRITE": "1"
      }
    }
  }
}
```

`LEADBAY_MCP_WRITE=1` opts in to write composites (the entire point of agent
flow — without it, the agent can read but not write). `LEADBAY_MCP_ADVANCED=1`
additionally exposes the granular tools; most users don't need it.

### OpenClaw plugin

In the plugin config (e.g. `openclaw config set plugins.entries.leadclaw.exposeWrite true`):

```json
{
  "region": "us",
  "exposeWrite": true,
  "exposeGranular": false
}
```

Default is read-only (exposeWrite=false, exposeGranular=false).

### What you might need to change in your prompts

- If your prompts reference `leadbay_find_prospects`, change to `leadbay_pull_leads`.
- If your prompts reference `leadbay_get_lead_profile` directly, prefer
  `leadbay_research_lead` for the agent-friendly shape.
- If your agent calls `leadbay_add_note` for outreach actions, switch to
  `leadbay_report_outreach` with `verification`.

## Out of scope for this release

- Per-tool semver versioning (the `Tool.version` field is in `types.ts` but
  individual tool files don't yet declare versions).
- A real `bulk_id` polling tool — the backend doesn't return one from `/launch`
  and there's no list endpoint (probed). Use `leadbay_get_contacts` per-lead
  to detect when `enrichment.done` flips.
- A `DELETE /lenses/{draftId}` endpoint — not testable in our tenant; treated
  as best-effort with `orphan_draft_id` surfaced on cleanup failure.

---

# Migration: leadbay-mcp 0.4.x → 0.5.0

The 0.5.0 release adds three new tools and extends `leadbay_import_leads` to support custom fields. This is purely additive — existing 0.4.x callers see no behavior change.

## What's new

| Tool | Purpose |
|---|---|
| `leadbay_list_mappable_fields` | Discovery: lists every CRM field (standard + this org's custom fields) the agent can target in `mappings.fields`. |
| `leadbay_import_and_qualify` | The mission verb: imports leads + triggers AI qualification + returns per-question answers in one call. Resumable via `qualify_id`. |
| `leadbay_qualify_status` | Retrieves a previously-launched qualification by `qualify_id` (handle persists 30d). |
| `leadbay_import_leads` 0.3.0 | Adds `mappings.custom_fields` ergonomic shorthand alongside the raw `mappings.fields[col] = "CUSTOM.<id>"` wire format. |

## Worked example: discover → import → qualify

```jsonc
// 1. Discover what fields are mappable on this org.
leadbay_list_mappable_fields()
// → {
//   "standard_fields": [{name:"LEAD_NAME", description:"...", mapping_value:"LEAD_NAME"}, ...],
//   "custom_fields":   [{id:"8", name:"priority_test", type:"TEXT", mapping_value:"CUSTOM.8"}, ...],
//   "_meta": {region: "us", endpoint: "GET /crm/custom_fields", latency_ms: 78}
// }

// 2. (Optional) preview the wizard's mapping suggestions for a sample.
leadbay_import_and_qualify({
  records: [{Brand: "Apple", Site: "apple.com", Priority: "high"}],
  dry_run: "preview"
})
// → {
//   kind: "preview",
//   mapping_hints: [{column: "Site", suggested_field: "LEAD_WEBSITE", ai_confidence: 95}],
//   custom_field_candidates: [{column: "Priority", candidates: [{id:"8", mapping_value:"CUSTOM.8", reason:"fuzzy_substring_match"}]}],
//   sample_rows: [{Brand: "Apple", Site: "apple.com", Priority: "high"}],
//   import_id: "<uuid>"
// }

// 3. Run the full flow with the chosen mapping.
leadbay_import_and_qualify({
  records: [{Brand: "Apple", Site: "apple.com", Priority: "high"}],
  mappings: {
    fields: {Brand: "LEAD_NAME", Site: "LEAD_WEBSITE"},
    custom_fields: {Priority: "priority_test"}   // resolved against /crm/custom_fields
  }
})
// → {
//   kind: "result",
//   qualify_id: "<uuidv4>",                   // resumable handle
//   import_ids: ["<uuid>"],
//   imported: [{leadId: "...", domain: "apple.com", name: "APPLE", rowId: "..."}],
//   not_imported: [],
//   qualified: [{
//     lead_id: "...",
//     qualifications: [{question: "Is the company...", score: 20, response: "yes...", computed_at: "..."}, ...],
//     qualification_summary: {answered: 3, total: 3, avg_qualification_boost: 13.3},
//     human_summary: "answered 3/3 — strong positive on 'Is the company...', positive on '...'",
//     signals_count: 12
//   }],
//   still_running: [],
//   chosen_budgets: {strategy: "small", total_budget_ms: 180000, wall_clock_estimate_ms: 60000, ...}
// }

// 4. If still_running was non-empty, retrieve later via qualify_id.
leadbay_qualify_status({qualify_id: "<uuid>"})
// → same shape, refreshed against backend at call time. failed[] populated
//   for any leads that 404'd between launch and status-check.
```

## Custom fields wire format

The backend serializer accepts `"CUSTOM.<id>"` as a value in the `mappings.fields` map. 0.3.0 of `leadbay_import_leads` accepts both:

```jsonc
// raw wire form (passes through unchanged):
mappings.fields = {col: "CUSTOM.8"}

// ergonomic shorthand (resolved against /crm/custom_fields):
mappings.custom_fields = {col: 8}             // numeric id
mappings.custom_fields = {col: "8"}           // string-shaped id
mappings.custom_fields = {col: "priority_test"}  // exact name (case-insensitive fallback)
```

New error codes (all surfaced with hint pointing at next action):
`IMPORT_CUSTOM_FIELD_UNKNOWN`, `IMPORT_INVALID_CUSTOM_MAPPING`, `IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS`, `IMPORT_CUSTOM_FIELD_CATALOG_REQUIRED`, `IMPORT_MAPPING_DUPLICATE_CUSTOM`, `IMPORT_MAPPING_CONFLICT_TARGET`.

## Bulk store schema widening

`~/.leadbay/bulks.json` now has a `kind: "enrich" | "qualify"` discriminator. Old enrich rows (no `kind` field) are read with `kind: "enrich"` defaulted in. Existing `leadbay_bulk_enrich_status` callers see no change. Querying an enrich `bulk_id` via `leadbay_qualify_status` (or vice versa) returns the new `BULK_WRONG_KIND` error pointing at the right tool.

## Adaptive budgets

When `leadbay_import_and_qualify` is called with no `total_budget_ms` or `per_lead_budget_ms`, the composite picks a strategy from input size:

| Input size | Strategy | total_budget_ms | per_lead_budget_ms |
|---|---|---|---|
| ≤ 5 leads | small | 3 min | 60s |
| 6 – 20 leads | default | 10 min | 90s |
| > 20 leads | large | 25 min | 120s |

The chosen values appear on the response as `chosen_budgets: {strategy, total_budget_ms, per_lead_budget_ms, wall_clock_estimate_ms}` so the agent can communicate the wall-clock to the human user.

## See also

- [CHANGELOG.md 0.5.0 entry](./CHANGELOG.md) — full release notes.

## Error-code reference (0.5.0)

Quick-reference for new error codes shipped in 0.5.0:

| Code | When | Next action |
|---|---|---|
| `IMPORT_CUSTOM_FIELD_UNKNOWN` | Caller passed `CUSTOM.<id>` or `mappings.custom_fields[col]` that doesn't exist on this org. | Call `leadbay_list_mappable_fields()`; pick a real id/name from `custom_fields[]`. |
| `IMPORT_INVALID_CUSTOM_MAPPING` | Caller passed a mapping value that's neither a StandardCrmFieldType nor a well-formed `CUSTOM.<digits>`. | Use a value from `leadbay_list_mappable_fields()` `mapping_value` field. |
| `IMPORT_CUSTOM_FIELD_NAME_AMBIGUOUS` | Two custom fields share the name (case-insensitive) the caller used. | Pass the numeric id instead. |
| `IMPORT_MAPPING_DUPLICATE_CUSTOM` | Same column appears in both `mappings.fields` and `mappings.custom_fields`. | Pick one of the two maps; remove the duplicate. |
| `IMPORT_MAPPING_CONFLICT_TARGET` | Two columns map to the same StandardCrmFieldType (e.g. both → `LEAD_NAME`). | Pick the column that contains the real value; drop the others from the mapping. |
| `IMPORT_CUSTOM_FIELD_CATALOG_REQUIRED` | Internal: catalog couldn't be fetched. | Retry; or use raw `CUSTOM.<id>` in `mappings.fields` instead of shorthand. |
| `BULK_TRACKER_UNAVAILABLE` | MCP server has no BulkTracker (qualify_id persistence). | Restart with `LEADBAY_BULK_STORE_ALLOW_MEMORY=1` or upgrade. |
| `BULK_INVALID_ID` | `qualify_id` is not a valid UUIDv4. | Pass the id returned by the prior `leadbay_import_and_qualify` call verbatim. |
| `BULK_NOT_FOUND` | Handle expired (>30d TTL) or never existed. | Re-launch via `leadbay_import_and_qualify`. |
| `BULK_PENDING` | Launch in flight or crashed mid-launch. | Retry in a few seconds; if persists >60s, relaunch. |
| `BULK_LAUNCH_FAILED` | The original launch failed permanently. | Re-launch. |
| `BULK_WRONG_KIND` | Caller passed an enrich `bulk_id` to `leadbay_qualify_status` (or vice versa). | Switch tools — enrich → `leadbay_bulk_enrich_status`, qualify → `leadbay_qualify_status`. |
| `IMPORT_PREVIEW_NO_UPLOAD` | Preview mode hit all-malformed input; nothing was uploaded. | Check that at least one record/domain is well-formed. |

## Per-tool prereqs (0.5.0)

Quick scan of what each new tool requires before invocation:

| Tool | Admin role | Active billing | LEADBAY_MCP_WRITE |
|---|---|---|---|
| `leadbay_list_mappable_fields` | no | no | no (read-only) |
| `leadbay_qualify_status` | no | no | no (read-only) |
| `leadbay_import_and_qualify` | yes | yes | yes (`=1`, default ON in 0.3.0+) |
| `leadbay_import_leads` (0.3.0) | yes | yes | yes |

Pre-flight: call `leadbay_account_status` to read `user.admin` and `organization.plan`. Both writes will return typed errors (`IMPORT_ADMIN_REQUIRED` / `IMPORT_BILLING_REQUIRED` / `FORBIDDEN`) at the call site too — pre-flighting just gives the agent a chance to ask the user politely instead of attempting a write that 403s.
