# MCP telemetry dashboard

Queries PostHog for the MCP event stream and renders a self-contained,
auto-refreshing HTML dashboard. Two ways to run it:

- **CLI** (`posthog-dashboard.ts`) — generate a one-off `mcp-dashboard.html` locally.
- **Server** (`dashboard-server.ts`) — long-running HTTP server that regenerates
  every 60s and serves behind basic auth. This is what's deployed to Fly.io.

GitHub issue: [leadbay/product#3688](https://github.com/leadbay/product/issues/3688).
Live (password-gated): https://leadbay-mcp-dashboard.fly.dev

---

## Credentials — environment only

The PostHog **personal** API key is read from the environment and is never
committed or printed. Source it from the git-ignored `.env.posthog`:

```bash
set -a && . /path/to/.env.posthog && set +a
export POSTHOG_PERSONAL_API_KEY="$PERSONAL_API_KEY"   # .env.posthog names it PERSONAL_API_KEY
```

| Var | Required | Default |
|---|---|---|
| `POSTHOG_PERSONAL_API_KEY` | yes | — |
| `POSTHOG_PROJECT_ID` | no | `23333` |
| `POSTHOG_HOST` | no | `https://eu.posthog.com` |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | server only | — |
| `DASHBOARD_DAYS` | no | `30` |
| `DASHBOARD_REFRESH_MS` | no | `60000` |
| `DASHBOARD_DRILLDOWN_MAX` | no | `8` |
| `PORT` | no | `8080` |

The dashboard supports a **date range** via the URL: `?days=N` or
`?start=YYYY-MM-DD&end=YYYY-MM-DD`. The server generates + caches each range on
demand (LRU, 12 ranges). `DASHBOARD_DRILLDOWN_MAX` caps how many top users get
the per-user click-through detail (the heaviest part of generation) — the roster
table still lists everyone. Lower it if you hit PostHog rate limits; raise it for
deeper drill-down on small teams.

---

## Generate locally

```bash
npx tsx packages/mcp/scripts/posthog-dashboard.ts --out ~/mcp-dashboard.html
# flags: --days <n>   --out <path>   --json (also dump raw data)
```

Open the HTML file in a browser. Generated `*.html` / `*.data.json` are
git-ignored — only the scripts are committed.

## Run the server locally

```bash
cd packages/mcp/scripts && npm install
DASHBOARD_USER=leadbay DASHBOARD_PASSWORD=leadbay PORT=8099 \
  node node_modules/tsx/dist/cli.mjs dashboard-server.ts
# → http://localhost:8099  (basic auth leadbay/leadbay)
```

---

## How to modify it

**Add / change a metric** — edit the `panels[]` array in `posthog-dashboard.ts`.
Each panel is one object:

```ts
{
  id: "my-metric",
  title: "...",
  subtitle: "...",
  kind: "hbar",   // stackedBar | line | table | donut | funnel | hbar | friction
  wide: true,     // optional: span full width (for wide tables)
  query: `SELECT ... FROM events WHERE event = 'mcp tool called' AND ${WINDOW} ...`,
}
```

Add an entry → it renders automatically. The `${WINDOW}` / `${MCP_ONLY}`
fragments scope queries to the MCP surface and the lookback window.

- **Chart look** → the `<style>` block + per-`kind` Chart.js config near the
  bottom of `posthog-dashboard.ts`.
- **Per-user drill-down** (roster row click) → `fetchUserDetail()` + the
  `openUser()` modal JS. Keep per-user queries **sequential** — PostHog caps
  concurrent queries at 3 per team.
- **Refresh interval / region / password** → `fly.toml` (`DASHBOARD_REFRESH_MS`)
  or `flyctl secrets set`, then redeploy.

---

## Deploy

Auto-deploys on push to `main` when anything under `packages/mcp/scripts/`
changes (`.github/workflows/deploy-dashboard.yml`). Requires repo secret
`FLY_API_TOKEN`.

Manual deploy:

```bash
cd packages/mcp/scripts && flyctl deploy -a leadbay-mcp-dashboard --ha=false
```

Fly secrets (set once, survive deploys):

```bash
flyctl secrets set -a leadbay-mcp-dashboard \
  POSTHOG_PERSONAL_API_KEY=… DASHBOARD_USER=… DASHBOARD_PASSWORD=…
```

App: `leadbay-mcp-dashboard` · org `milan-stankovic` · region `cdg` (Paris) ·
1× shared-cpu-1x / 256MB.
