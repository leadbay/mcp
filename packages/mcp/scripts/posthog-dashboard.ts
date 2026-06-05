#!/usr/bin/env tsx
/**
 * MCP telemetry dashboard generator (GitHub issue #3688).
 *
 * Queries PostHog for the MCP-only event stream (everything tagged
 * `source = "mcp"` plus the `mcp *` / `agent_memory_*` events) and emits a
 * self-contained interactive HTML dashboard you open in a browser. Mirrors
 * the eval HTML dashboard pattern (test/eval/helpers/gen-dashboard.py): one
 * generator script, one standalone HTML output, no build step.
 *
 * Credentials come from the environment ONLY — never hard-coded, never
 * written into the output:
 *
 *   POSTHOG_PERSONAL_API_KEY   (required)  personal API key (phx_…)
 *   POSTHOG_PROJECT_ID         (optional)  default 23333
 *   POSTHOG_HOST               (optional)  default https://eu.posthog.com
 *
 * The project's frontend + MCP both report to project 23333 (EU). Source the
 * key from .env.posthog (git-ignored) before running:
 *
 *   set -a && source /path/to/.env.posthog && set +a
 *   pnpm --filter @leadbay/mcp mcp:dashboard
 *
 * Flags:
 *   --days <n>     lookback window (default 30)
 *   --out <path>   output HTML path (default ./mcp-dashboard.html)
 *   --json         also write the raw queried data next to the HTML
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Config from env (NEVER inline the key) ──────────────────────────────────
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? "23333";
const HOST = (process.env.POSTHOG_HOST ?? "https://eu.posthog.com").replace(/\/$/, "");

if (!API_KEY) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY. Source it from your .env.posthog (git-ignored), e.g.:\n" +
      "  set -a && source .env.posthog && set +a\n" +
      "then re-run. The key is read from the environment only — it is never stored or printed."
  );
  process.exit(1);
}

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DAYS = parseInt(argVal("--days", "30"), 10);
const OUT = resolve(process.cwd(), argVal("--out", "mcp-dashboard.html"));
const WRITE_JSON = argv.includes("--json");

// ── Date range ───────────────────────────────────────────────────────────────
// The window can be given two ways:
//   --start YYYY-MM-DD --end YYYY-MM-DD   explicit range (end is exclusive)
//   --days N                              last N days (default; --end defaults to today)
// Explicit dates win. We resolve everything to concrete YYYY-MM-DD bounds so the
// snapshot queries ("active at end", "new in window") share the exact same edges
// and the UI can echo the chosen range back. now()/new Date() are avoided in the
// generator's query strings — we pass real dates so results are deterministic.
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const argStart = argVal("--start", "");
const argEnd = argVal("--end", "");
// End defaults to tomorrow (so "today" is fully included, end being exclusive).
const END = argEnd || isoDate(new Date(Date.now() + 86_400_000));
const START =
  argStart ||
  isoDate(new Date(new Date(END).getTime() - DAYS * 86_400_000));
// Human label for the header, e.g. "May 1 – May 31, 2026 (31 days)".
const rangeDays = Math.max(
  1,
  Math.round((new Date(END).getTime() - new Date(START).getTime()) / 86_400_000)
);
const RANGE_LABEL = `${START} → ${END} (${rangeDays} days)`;

// ── HogQL query helper ──────────────────────────────────────────────────────
// Hardened against the failure that hung whole-dashboard generation: a single
// PostHog request with NO timeout would hang forever when PostHog throttled us
// after a burst of queries, so the subprocess never exited and the server
// looped on "Generating…". Now every request has a hard timeout, and 429 /
// 5xx are retried with backoff (PostHog caps concurrency at 3 per team).
type Row = unknown[];
const QUERY_TIMEOUT_MS = 25_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialize all queries through a single chain with a small pacing delay. PostHog
// caps concurrency at 3/team and rate-limits bursts; pacing ~120ms apart keeps us
// under the wall, which is FAR cheaper than tripping it and eating 1.5s×N backoffs
// (that storm is what pushed recent-window ranges past the generation timeout).
const QUERY_PACING_MS = 120;
let queueTail: Promise<unknown> = Promise.resolve();
function hogql(query: string): Promise<Row[]> {
  const run = queueTail.then(async () => {
    await sleep(QUERY_PACING_MS);
    return hogqlOnce(query);
  });
  // Keep the chain alive even if one query rejects.
  queueTail = run.catch(() => undefined);
  return run;
}

async function hogqlOnce(query: string, attempt = 0): Promise<Row[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), QUERY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Timeout (abort) or network blip — retry a couple times before giving up.
    if (attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return hogqlOnce(query, attempt + 1);
    }
    throw new Error(`PostHog request failed after ${attempt + 1} tries: ${(err as Error).message}`);
  }
  clearTimeout(timer);
  // 429: PostHog tells us how long to wait (Retry-After header or "available in
  // N seconds" in the body). If that wait is SHORT, sleep it off and retry. If
  // it's LONG (the key is hard rate-limited), there's no point grinding the
  // remaining ~20 panel queries — each would 429 too and only push the reset
  // further out. Throw a distinct THROTTLED error so main() aborts the whole run
  // fast and the server keeps serving the last good cache instead of looping.
  if (res.status === 429) {
    const body = await res.clone().text().catch(() => "");
    const hdr = parseInt(res.headers.get("retry-after") ?? "", 10);
    const m = body.match(/available in (\d+) seconds/);
    const waitS = Number.isFinite(hdr) ? hdr : m ? parseInt(m[1], 10) : 5;
    if (waitS <= 15 && attempt < 4) {
      await sleep(waitS * 1000 + 500);
      return hogqlOnce(query, attempt + 1);
    }
    const e = new Error(`THROTTLED: PostHog rate limit, retry in ~${waitS}s`);
    (e as Error & { throttled?: number }).throttled = waitS;
    throw e;
  }
  // Transient server error → short backoff and retry.
  if (res.status >= 500 && attempt < 4) {
    await sleep(1500 * (attempt + 1));
    return hogqlOnce(query, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PostHog query failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { results?: Row[]; error?: string };
  if (json.error) throw new Error(`HogQL error: ${json.error}`);
  return json.results ?? [];
}

// Common WHERE clause: events within the selected range [START, END).
// Explicit dates (not now()-interval) keep the window deterministic and let the
// snapshot panel reuse the exact same edges.
const WINDOW = `timestamp >= '${START}' AND timestamp < '${END}'`;
const MCP_ONLY = `event LIKE 'mcp %' OR event LIKE 'agent_memory_%'`;

// "MCP users active in the window": anyone who fired an MCP / agent-memory event
// inside [START, END). The subscription panels are scoped to THIS set — so the
// counts answer "of MCP users active this period, how many bought T1 / sit on
// freemium / etc." Changing the range changes who's counted.
const MCP_USERS = `
  SELECT DISTINCT distinct_id FROM events
  WHERE (event LIKE 'mcp %' OR event LIKE 'agent_memory_%')
        AND timestamp >= '${START}' AND timestamp < '${END}'`;
const IS_MCP_USER = `distinct_id IN (${MCP_USERS})`;

// Canonical tier source: each account's latest quota_plan_changed.new_plan AS OF
// the end of the range — i.e. the tier they were on at END. Restricted to MCP
// users active in the window. stripe_subscription_created carries no tier.
const LATEST_PLAN_PER_USER = `
  SELECT distinct_id, argMax(properties.new_plan, timestamp) AS plan
  FROM events WHERE event='quota_plan_changed' AND timestamp < '${END}' AND ${IS_MCP_USER}
  GROUP BY distinct_id`;

// ── Panel definitions ───────────────────────────────────────────────────────
// Each panel runs a query and is rendered by `kind`. Adding a metric = one
// entry here. Keeps the dashboard consistent and easy to extend.
interface Panel {
  id: string;
  title: string;
  subtitle?: string;
  kind: "stackedBar" | "line" | "multiline" | "table" | "friction" | "donut" | "funnel" | "hbar" | "snapshot";
  columns?: string[];
  wide?: boolean; // span full grid width (for tables with many columns)
  query: string;
  data?: Row[];
}

const panels: Panel[] = [
  // ── Subscription / billing overview (MCP users only) ──────────────────────
  // Where MCP users sit by plan tier, and their subscription + top-up activity.
  // Every panel below is filtered to accounts that have touched the MCP (via
  // IS_MCP_USER) — so these answer "how are MCP users monetising", not the
  // whole product. They sit at the top, above the tool-usage telemetry.
  {
    // Headline snapshot — the answer to "for this window, how many users bought
    // T1/T2 and how many are active freemium". Two metrics per tier:
    //   • New in window  — first reached this tier inside [START, END)
    //   • Active at end  — tier they sit on as of END (snapshot)
    // Plus active freemium = on FREEMIUM at END *and* used the MCP in the window.
    // Data is assembled in main() from two queries (see buildSnapshot), so the
    // query field is unused; rendered by the "snapshot" kind as big stat cards.
    id: "subscription-snapshot",
    title: "Subscription snapshot",
    subtitle: `MCP users active in range · ${RANGE_LABEL}`,
    kind: "snapshot",
    wide: true,
    query: "",
  },
  {
    id: "accounts-by-tier",
    title: "Accounts by plan tier",
    subtitle: `MCP users active in range · tier as of ${END}`,
    kind: "donut",
    query: `
      SELECT plan, count() AS accounts
      FROM (${LATEST_PLAN_PER_USER})
      WHERE plan != '' AND plan IS NOT NULL
      GROUP BY plan ORDER BY accounts DESC`,
  },
  {
    id: "subscription-summary",
    title: "Subscriptions & top-ups",
    subtitle: `MCP users active in range · counts + revenue · ${RANGE_LABEL}`,
    kind: "table",
    columns: ["Metric", "Count", "Accounts", "€"],
    query: `
      SELECT metric, n, accounts, eur FROM (
        SELECT 0 AS ord, 'New accounts' AS metric, count() AS n, count(DISTINCT distinct_id) AS accounts, '' AS eur
          FROM events WHERE event='wow user create account' AND ${WINDOW} AND ${IS_MCP_USER}
        UNION ALL
        SELECT 1, 'New subscriptions', count(), count(DISTINCT distinct_id), ''
          FROM events WHERE event='stripe_subscription_created' AND ${WINDOW} AND ${IS_MCP_USER}
        UNION ALL
        SELECT 2, 'Subscription updates', count(), count(DISTINCT distinct_id), ''
          FROM events WHERE event='stripe_subscription_updated' AND ${WINDOW} AND ${IS_MCP_USER}
        UNION ALL
        SELECT 3, 'Upgrades to paid', count(), count(DISTINCT distinct_id), ''
          FROM events WHERE event='quota_plan_changed' AND properties.new_plan IN ('TIER1','TIER2')
                AND (properties.old_plan IS NULL OR properties.old_plan NOT IN ('TIER1','TIER2'))
                AND ${WINDOW} AND ${IS_MCP_USER}
        UNION ALL
        SELECT 4, 'Top-ups (purchased)', count(), count(DISTINCT distinct_id),
               concat('€', toString(round(sum(toInt(properties.payment_amount_cents))/100)))
          FROM events WHERE event='topup_purchased' AND ${WINDOW} AND ${IS_MCP_USER}
        UNION ALL
        SELECT 5, 'Top-ups (initiated)', count(), count(DISTINCT distinct_id), ''
          FROM events WHERE event='topup_init' AND ${WINDOW} AND ${IS_MCP_USER}
      ) ORDER BY ord ASC`,
  },
  {
    id: "topups-by-tier",
    title: "Top-ups by plan tier",
    subtitle: `MCP users active in range · which tier buys credits · ${RANGE_LABEL}`,
    kind: "table",
    columns: ["Plan tier", "Top-ups", "Accounts", "€ total"],
    query: `
      SELECT coalesce(nullIf(t.plan,''), '(no plan recorded)') AS tier,
             count() AS topups,
             count(DISTINCT e.distinct_id) AS accounts,
             concat('€', toString(round(sum(e.cents)/100))) AS eur
      FROM (
        SELECT distinct_id, toInt(properties.payment_amount_cents) AS cents
        FROM events WHERE event='topup_purchased' AND ${WINDOW} AND ${IS_MCP_USER}
      ) e
      LEFT JOIN (${LATEST_PLAN_PER_USER}) t ON e.distinct_id = t.distinct_id
      GROUP BY tier ORDER BY topups DESC`,
  },
  {
    id: "paid-by-month",
    title: "New paid subscriptions by month",
    subtitle: "MCP users only · distinct accounts upgrading INTO each tier · per calendar month",
    kind: "table",
    columns: ["Month", "TIER1", "TIER2", "Total"],
    query: `
      SELECT formatDateTime(month, '%Y-%m') AS month,
             countIf(tier='TIER1') AS tier1,
             countIf(tier='TIER2') AS tier2,
             count() AS total
      FROM (
        SELECT distinct_id,
               properties.new_plan AS tier,
               toStartOfMonth(min(timestamp)) AS month
        FROM events
        WHERE event='quota_plan_changed' AND properties.new_plan IN ('TIER1','TIER2')
              AND (properties.old_plan IS NULL OR properties.old_plan NOT IN ('TIER1','TIER2'))
              AND ${WINDOW} AND ${IS_MCP_USER}
        GROUP BY distinct_id, tier
      )
      GROUP BY month ORDER BY month DESC`,
  },
  {
    // The detail behind paid-by-month: WHO subscribed to WHICH tier, and the
    // exact date. Deduped to the FIRST time each account reached each tier
    // (the web app fires quota_plan_changed twice per upgrade ~1s apart, and
    // some accounts toggle plans — min(timestamp) per (account,tier) collapses
    // both). Newest first. Scoped to MCP users active in the range.
    id: "subscription-dates",
    title: "Subscription dates by tier",
    subtitle: `MCP users active in range · first date each account reached a paid tier`,
    kind: "table",
    wide: true,
    columns: ["Date", "Tier", "Account", "From"],
    query: `
      SELECT formatDateTime(first_reached, '%Y-%m-%d') AS date,
             tier,
             account,
             coalesce(nullIf(from_plan, ''), '(new / none)') AS from_plan
      FROM (
        SELECT distinct_id AS account,
               properties.new_plan AS tier,
               min(timestamp) AS first_reached,
               argMin(properties.old_plan, timestamp) AS from_plan
        FROM events
        WHERE event='quota_plan_changed' AND properties.new_plan IN ('TIER1','TIER2')
              AND ${WINDOW} AND ${IS_MCP_USER}
        GROUP BY distinct_id, tier
      )
      ORDER BY first_reached DESC LIMIT 100`,
  },
  {
    // One feed answering "in this period: who bought what, and when" — both
    // subscriptions (first-reach per tier, deduped) AND top-up purchases,
    // merged and sorted by date. Top-ups can repeat (christophe topped up
    // twice) so they are NOT deduped — each purchase is its own dated row.
    // Driven entirely by the top date picker (WINDOW).
    id: "purchases-in-period",
    title: "Purchases in period — subscriptions & top-ups",
    subtitle: `MCP users active in range · every dated purchase · ${RANGE_LABEL}`,
    kind: "table",
    wide: true,
    columns: ["Date", "Type", "Account", "Detail"],
    query: `
      SELECT formatDateTime(ts, '%Y-%m-%d') AS date, kind, account, detail FROM (
        SELECT min(timestamp) AS ts,
               concat('Subscribe ', properties.new_plan) AS kind,
               distinct_id AS account,
               concat('from ', coalesce(nullIf(properties.old_plan, ''), 'new')) AS detail
        FROM events
        WHERE event='quota_plan_changed' AND properties.new_plan IN ('TIER1','TIER2')
              AND ${WINDOW} AND ${IS_MCP_USER}
        GROUP BY distinct_id, properties.new_plan, properties.old_plan
        UNION ALL
        SELECT timestamp AS ts,
               'Top-up' AS kind,
               distinct_id AS account,
               concat('€', toString(round(toInt(properties.payment_amount_cents)/100))) AS detail
        FROM events
        WHERE event='topup_purchased' AND ${WINDOW} AND ${IS_MCP_USER}
      ) ORDER BY ts DESC LIMIT 100`,
  },
  {
    id: "upgrade-paths",
    title: "Plan transitions into paid tiers",
    subtitle: `MCP users active in range · from → to · ${RANGE_LABEL}`,
    kind: "table",
    columns: ["From", "To", "Transitions"],
    query: `
      SELECT coalesce(nullIf(properties.old_plan,''), '(new / none)') AS from_plan,
             properties.new_plan AS to_plan,
             count() AS n
      FROM events
      WHERE event='quota_plan_changed' AND properties.new_plan IN ('TIER1','TIER2')
            AND ${WINDOW} AND ${IS_MCP_USER}
      GROUP BY from_plan, to_plan ORDER BY n DESC LIMIT 30`,
  },
  {
    id: "subscription-timeline",
    title: "Subscription activity over time",
    subtitle: "MCP users only · new accounts · new subscriptions · top-ups per day",
    kind: "multiline",
    columns: ["Day", "New accounts", "New subscriptions", "Top-ups"],
    query: `
      SELECT day,
             sum(accounts) AS accounts,
             sum(subs) AS subs,
             sum(topups) AS topups
      FROM (
        SELECT toDate(timestamp) AS day,
               countIf(event='wow user create account') AS accounts,
               countIf(event='stripe_subscription_created') AS subs,
               countIf(event='topup_purchased') AS topups
        FROM events
        WHERE event IN ('wow user create account','stripe_subscription_created','topup_purchased')
              AND ${WINDOW} AND ${IS_MCP_USER}
        GROUP BY day
      )
      GROUP BY day ORDER BY day ASC`,
  },
  {
    id: "tool-volume",
    title: "Tool calls by tool — success vs failure",
    subtitle: `${RANGE_LABEL} · 'mcp tool called'`,
    kind: "stackedBar",
    query: `
      SELECT properties.tool AS tool,
             countIf(properties.ok = true) AS ok,
             countIf(properties.ok = false) AS failed
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY tool ORDER BY ok + failed DESC LIMIT 40`,
  },
  {
    id: "calls-per-tool",
    title: "Calls per tool",
    subtitle: `Total volume · ${RANGE_LABEL}`,
    kind: "hbar",
    query: `
      SELECT properties.tool AS tool, count() AS calls
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY tool ORDER BY calls DESC LIMIT 30`,
  },
  {
    id: "version-dist",
    title: "MCP version distribution",
    subtitle: "unique users per version",
    kind: "donut",
    query: `
      SELECT version, count() AS users FROM (
        SELECT distinct_id, any(properties.mcp_version) AS version
        FROM events WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY distinct_id
      ) GROUP BY version ORDER BY users DESC`,
  },
  {
    id: "region-dist",
    title: "Users by region",
    subtitle: "unique users per region",
    kind: "donut",
    query: `
      SELECT region, count() AS users FROM (
        SELECT distinct_id, any(properties.region) AS region
        FROM events WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY distinct_id
      ) GROUP BY region ORDER BY users DESC`,
  },
  {
    id: "platform-dist",
    title: "Users by OS / platform",
    subtitle: "unique users per platform",
    kind: "donut",
    query: `
      SELECT platform, count() AS users FROM (
        SELECT distinct_id, any(properties.platform) AS platform
        FROM events WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY distinct_id
      ) GROUP BY platform ORDER BY users DESC`,
  },
  {
    id: "friction-by-category",
    title: "Friction by category",
    subtitle: "report count per category",
    kind: "donut",
    query: `
      SELECT properties.category AS category, count() AS n
      FROM events
      WHERE event = 'mcp friction reported' AND ${WINDOW}
      GROUP BY category ORDER BY n DESC`,
  },
  {
    id: "tool-latency",
    title: "Latency & reliability per tool",
    subtitle: "calls · success rate · avg / min / max ms",
    kind: "table",
    wide: true,
    columns: ["Tool", "Calls", "OK", "Failed", "Success %", "Avg ms", "Min ms", "Max ms"],
    query: `
      SELECT properties.tool AS tool,
             count() AS calls,
             countIf(properties.ok = true) AS ok,
             countIf(properties.ok = false) AS failed,
             round(100 * countIf(properties.ok = true) / count(), 1) AS success_pct,
             round(avg(properties.duration_ms)) AS avg_ms,
             round(min(properties.duration_ms)) AS min_ms,
             round(max(properties.duration_ms)) AS max_ms
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY tool ORDER BY calls DESC LIMIT 40`,
  },
  {
    id: "daily-volume",
    title: "Daily call volume & unique users",
    subtitle: "calls per day, distinct users per day",
    kind: "line",
    query: `
      SELECT toDate(timestamp) AS day,
             count() AS calls,
             count(DISTINCT distinct_id) AS users
      FROM events
      WHERE event = 'mcp tool called' AND ${WINDOW}
      GROUP BY day ORDER BY day ASC`,
  },
  {
    id: "errors",
    title: "Error-code breakdown",
    subtitle: "failed tool calls by tool + error code",
    kind: "table",
    columns: ["Tool", "Error code", "Failures"],
    query: `
      SELECT properties.tool AS tool,
             properties.error_code AS error_code,
             count() AS failures
      FROM events
      WHERE event = 'mcp tool called' AND properties.ok = false AND ${WINDOW}
      GROUP BY tool, error_code ORDER BY failures DESC LIMIT 50`,
  },
  {
    id: "friction",
    title: "Friction feed",
    subtitle: "user-reported frustration (verbatim)",
    kind: "friction",
    query: `
      SELECT toDateTime(timestamp) AS ts,
             distinct_id AS user,
             properties.category AS category,
             properties.severity AS severity,
             properties.tool_called AS tool,
             properties.user_quote AS quote,
             properties.details AS details
      FROM events
      WHERE event = 'mcp friction reported' AND ${WINDOW}
      ORDER BY ts DESC LIMIT 50`,
  },
  {
    id: "auth-state",
    title: "Startup auth state",
    subtitle: "'mcp startup' auth_state distribution",
    kind: "donut",
    query: `
      SELECT properties.auth_state AS auth_state, count() AS n
      FROM events
      WHERE event = 'mcp startup' AND ${WINDOW}
      GROUP BY auth_state ORDER BY n DESC`,
  },
  {
    id: "update-funnel",
    title: "Auto-update funnel",
    subtitle: "check → prompted → dismissed → version updated",
    kind: "funnel",
    query: `
      SELECT event, count() AS n
      FROM events
      WHERE event IN ('mcp update check','mcp update prompted','mcp update install_clicked','mcp update dismissed','mcp version updated')
        AND ${WINDOW}
      GROUP BY event`,
  },
  {
    id: "roster",
    title: "User roster",
    subtitle: "registered · region · platform · version · MCP events",
    kind: "table",
    wide: true,
    columns: ["User", "Registered", "Region", "Platform", "MCP version", "Events"],
    query: `
      SELECT e.user AS user,
             coalesce(substring(reg.created, 1, 10), '—') AS registered,
             e.region AS region,
             e.platform AS platform,
             e.version AS version,
             e.events AS events
      FROM (
        SELECT distinct_id AS user,
               any(properties.region) AS region,
               any(properties.platform) AS platform,
               any(properties.mcp_version) AS version,
               count() AS events
        FROM events
        WHERE (${MCP_ONLY}) AND ${WINDOW}
        GROUP BY user
      ) e
      LEFT JOIN (
        SELECT pdi.distinct_id AS did, toString(p.created_at) AS created
        FROM person_distinct_ids pdi JOIN persons p ON pdi.person_id = p.id
      ) reg ON e.user = reg.did
      ORDER BY e.events DESC LIMIT 60`,
  },
  {
    id: "memory",
    title: "Agent memory activity",
    subtitle: "capture / recall / prune",
    kind: "table",
    columns: ["Event", "Count", "Users"],
    query: `
      SELECT event, count() AS n, count(DISTINCT distinct_id) AS users
      FROM events
      WHERE event LIKE 'agent_memory_%' AND ${WINDOW}
      GROUP BY event ORDER BY n DESC`,
  },
];

// ── Per-user drill-down ───────────────────────────────────────────────────────
// For each roster user, fetch advanced metrics + their prompts (triggered_by),
// embedded as JSON so a row click opens a detail modal — no extra requests.
interface UserDetail {
  user: string;
  summary: { calls: number; ok: number; failed: number; tools: number; firstSeen: string; lastSeen: string };
  registeredAt: string;    // persons.created_at — true signup date (covers users predating the signup event)
  byTool: Row[]; // [tool, calls, ok, failed, avg_ms]
  errors: Row[]; // [tool, error_code, n]
  prompts: Row[]; // [ts, tool, ok, error_code, prompt]
  // Plan & credits. PostHog carries quota-HIT events, not a running credit
  // ledger — so this is consumption *pressure* (when/which window they blew
  // through), NOT an exact remaining balance. The UI labels it as such.
  billing: {
    freemium: string;      // 'true' | 'false' | ''
    status: string;        // billingStatus: OK / NOT_SET_UP / ...
    resetsAt: string;      // quota_exceeded_resets_at
    plan: string;          // latest quota_plan_changed.new_plan
  };
  quotaHits: Row[];        // [resource_type, window_type, hits] — how credits were consumed
  topups: { count: number; totalCents: number };
}

// One combined per-user query keeps us well under PostHog's 3-concurrent-query
// cap: each user is a single round-trip instead of four.
async function fetchUserDetail(user: string): Promise<UserDetail> {
  const u = user.replace(/'/g, "''"); // escape for HogQL string literal
  const where = `event='mcp tool called' AND distinct_id='${u}' AND ${WINDOW}`;
  const [summaryRows, byTool, errors, prompts] = [
    await hogql(`SELECT count() AS calls, countIf(properties.ok=true) AS ok, countIf(properties.ok=false) AS failed,
                   count(DISTINCT properties.tool) AS tools,
                   toString(min(toDateTime(timestamp))) AS first_seen,
                   toString(max(toDateTime(timestamp))) AS last_seen
            FROM events WHERE ${where}`),
    await hogql(`SELECT properties.tool AS tool, count() AS calls, countIf(properties.ok=true) AS ok,
                   countIf(properties.ok=false) AS failed, round(avg(properties.duration_ms)) AS avg_ms
            FROM events WHERE ${where}
            GROUP BY tool ORDER BY calls DESC`),
    await hogql(`SELECT properties.tool AS tool, properties.error_code AS error_code, count() AS n
            FROM events WHERE ${where} AND properties.ok=false
            GROUP BY tool, error_code ORDER BY n DESC`),
    await hogql(`SELECT toString(toDateTime(timestamp)) AS ts, properties.tool AS tool, properties.ok AS ok,
                   properties.error_code AS error_code, properties.triggered_by AS prompt
            FROM events WHERE ${where}
                  AND properties.triggered_by IS NOT NULL AND properties.triggered_by != ''
            ORDER BY ts DESC LIMIT 200`),
  ];

  // Plan & billing from the person record (current state) + latest plan change.
  const billingRows = await hogql(
    `SELECT p.properties.is_freemium AS freemium, p.properties.billingStatus AS status,
            p.properties.quota_exceeded_resets_at AS resets_at,
            (SELECT properties.new_plan FROM events
               WHERE event='quota_plan_changed' AND distinct_id='${u}'
               ORDER BY timestamp DESC LIMIT 1) AS plan,
            toString(p.created_at) AS registered_at
     FROM person_distinct_ids pdi JOIN persons p ON pdi.person_id = p.id
     WHERE pdi.distinct_id='${u}' LIMIT 1`
  ).catch(() => [] as Row[]);

  // Credit consumption pressure: which budget window they blew through, and
  // how often. NOT a balance — PostHog only records the quota-exceeded moments.
  const quotaHits = await hogql(
    `SELECT properties.resource_type AS resource, properties.window_type AS window, count() AS hits
     FROM events WHERE event='quota_exceeded' AND distinct_id='${u}' AND ${WINDOW}
     GROUP BY resource, window ORDER BY hits DESC`
  ).catch(() => [] as Row[]);

  // Top-ups: real money spent unblocking quota.
  const topupRows = await hogql(
    `SELECT count() AS n, sum(toInt(properties.payment_amount_cents)) AS cents
     FROM events WHERE event='topup_purchased' AND distinct_id='${u}' AND ${WINDOW}`
  ).catch(() => [] as Row[]);

  const s = (summaryRows[0] as unknown[]) ?? [];
  const b = (billingRows[0] as unknown[]) ?? [];
  const t = (topupRows[0] as unknown[]) ?? [];
  return {
    user,
    summary: {
      calls: Number(s[0] ?? 0), ok: Number(s[1] ?? 0), failed: Number(s[2] ?? 0),
      tools: Number(s[3] ?? 0), firstSeen: String(s[4] ?? ""), lastSeen: String(s[5] ?? ""),
    },
    registeredAt: String(b[4] ?? ""),
    byTool, errors, prompts,
    billing: {
      freemium: String(b[0] ?? ""), status: String(b[1] ?? ""),
      resetsAt: String(b[2] ?? ""), plan: String(b[3] ?? ""),
    },
    quotaHits,
    topups: { count: Number(t[0] ?? 0), totalCents: Number(t[1] ?? 0) },
  };
}

// ── Headline subscription snapshot ────────────────────────────────────────────
// Per tier: [newInWindow, activeAtEnd]. Plus the active-freemium count.
// Two clean queries combined here (a single correlated SQL was rejected by
// HogQL). Each row: [tier, newInWindow, activeAtEnd].
async function buildSnapshot(): Promise<Row[]> {
  // Active at end: latest plan as of END, MCP users active in window.
  const activeRows = await hogql(`
    SELECT plan, count() AS users FROM (${LATEST_PLAN_PER_USER})
    WHERE plan IN ('FREEMIUM','TIER1','TIER2') GROUP BY plan`);
  // New in window: first reached T1/T2 inside [START, END), MCP users active in window.
  const newRows = await hogql(`
    SELECT tier, count() AS users FROM (
      SELECT distinct_id, properties.new_plan AS tier, min(timestamp) AS first_ts
      FROM events
      WHERE event='quota_plan_changed' AND properties.new_plan IN ('TIER1','TIER2') AND ${IS_MCP_USER}
      GROUP BY distinct_id, tier
    ) WHERE first_ts >= '${START}' AND first_ts < '${END}' GROUP BY tier`);
  const active: Record<string, number> = {};
  for (const r of activeRows) active[String((r as Row)[0])] = Number((r as Row)[1] ?? 0);
  const fresh: Record<string, number> = {};
  for (const r of newRows) fresh[String((r as Row)[0])] = Number((r as Row)[1] ?? 0);
  // Row order: paid tiers first, then freemium. [tier, new_in_window, active_at_end].
  return [
    ["TIER1", fresh.TIER1 ?? 0, active.TIER1 ?? 0],
    ["TIER2", fresh.TIER2 ?? 0, active.TIER2 ?? 0],
    ["FREEMIUM", fresh.FREEMIUM ?? 0, active.FREEMIUM ?? 0],
  ];
}

// A hard rate-limit (long 429) bubbles up as a THROTTLED error. Detect it so we
// can abort the whole run fast instead of grinding every remaining query.
const isThrottled = (err: unknown): boolean =>
  err instanceof Error && err.message.startsWith("THROTTLED");
// Exit code the server reads to mean "rate-limited, back off — keep old cache".
const EXIT_THROTTLED = 75;

// ── Run all queries ──────────────────────────────────────────────────────────
async function main() {
  console.log(`Querying PostHog project ${PROJECT_ID} @ ${HOST} · range ${START} → ${END}…`);
  for (const p of panels) {
    // The snapshot panel is assembled from multiple queries, not p.query.
    if (p.kind === "snapshot") {
      try {
        p.data = await buildSnapshot();
        console.log(`  ✓ ${p.id} (snapshot)`);
      } catch (err) {
        if (isThrottled(err)) {
          console.error(`  ⏳ ${(err as Error).message} — aborting run`);
          process.exit(EXIT_THROTTLED);
        }
        p.data = [];
        console.error(`  ✗ ${p.id}: ${(err as Error).message}`);
      }
      continue;
    }
    try {
      p.data = await hogql(p.query);
      console.log(`  ✓ ${p.id} (${p.data.length} rows)`);
    } catch (err) {
      if (isThrottled(err)) {
        console.error(`  ⏳ ${(err as Error).message} — aborting run`);
        process.exit(EXIT_THROTTLED);
      }
      p.data = [];
      console.error(`  ✗ ${p.id}: ${(err as Error).message}`);
    }
  }

  // Per-user drill-down (the roster modal). This is the biggest time sink —
  // 6 sequential queries PER user — so it's CAPPED to the top N most-active
  // users. The roster table still lists everyone; only the click-through detail
  // is limited. Bounding it keeps generation fast and predictable regardless of
  // how many users are active in the window (which is what made recent-window
  // ranges hang before). Tune via DASHBOARD_DRILLDOWN_MAX.
  const DRILLDOWN_MAX = parseInt(process.env.DASHBOARD_DRILLDOWN_MAX ?? "8", 10);
  const roster = panels.find((p) => p.id === "roster")?.data ?? [];
  const allUsers = roster.map((r) => String((r as unknown[])[0])).filter((u) => !u.startsWith("mcp:"));
  const users = allUsers.slice(0, DRILLDOWN_MAX); // roster is already sorted by events desc
  const details: Record<string, UserDetail> = {};
  for (const u of users) {
    try {
      details[u] = await fetchUserDetail(u);
    } catch (err) {
      // A throttle mid-drill-down: stop fetching more users, but keep what we
      // have — the panels are already done, so the dashboard is still useful.
      if (isThrottled(err)) {
        console.error(`  ⏳ ${(err as Error).message} — stopping drill-down early`);
        break;
      }
      console.error(`  ✗ user-detail ${u}: ${(err as Error).message}`);
    }
  }
  const capped = allUsers.length > users.length ? ` (capped from ${allUsers.length})` : "";
  console.log(`  ✓ user-detail (${Object.keys(details).length}/${users.length} users${capped})`);

  const generatedAt = new Date().toISOString();
  const html = renderHTML(panels, details, generatedAt);
  writeFileSync(OUT, html, "utf8");
  console.log(`\nDashboard written: ${OUT}`);

  if (WRITE_JSON) {
    const jsonPath = OUT.replace(/\.html$/, "") + ".data.json";
    const dump = { panels: Object.fromEntries(panels.map((p) => [p.id, p.data])), userDetails: details };
    writeFileSync(jsonPath, JSON.stringify(dump, null, 2), "utf8");
    console.log(`Raw data written:  ${jsonPath}`);
  }
}

// ── HTML rendering ───────────────────────────────────────────────────────────
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Big stat-card grid for the headline snapshot. Each tier shows "new in window"
// and "active at end"; freemium is highlighted as the active-freemium count.
function renderSnapshot(p: Panel): string {
  const rows = (p.data ?? []) as Row[];
  const byTier: Record<string, [number, number]> = {};
  for (const r of rows) byTier[String(r[0])] = [Number(r[1] ?? 0), Number(r[2] ?? 0)];
  const card = (label: string, tier: string, accent: string): string => {
    const [fresh, active] = byTier[tier] ?? [0, 0];
    return `<div class="snap-card" style="border-top-color:${accent}">
      <div class="snap-tier">${esc(label)}</div>
      <div class="snap-big">${active}<span class="snap-unit">active at ${esc(END)}</span></div>
      <div class="snap-new">+${fresh} new in this period</div>
    </div>`;
  };
  return `<section class="panel full"><h2>${esc(p.title)}</h2>${
    p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
  }<div class="snap-grid">
    ${card("TIER 1", "TIER1", "#58a6ff")}
    ${card("TIER 2", "TIER2", "#bc8cff")}
    ${card("Freemium (active)", "FREEMIUM", "#3fb950")}
  </div>
  <p class="sub" style="margin-top:12px">“Active at ${esc(
    END
  )}” = MCP users active in this period whose plan is that tier as of the end date. “New in this period” = first upgraded into that tier between ${esc(
    START
  )} and ${esc(END)}.</p></section>`;
}

function renderPanel(p: Panel): string {
  const rows = p.data ?? [];
  const dataJson = JSON.stringify(rows);
  switch (p.kind) {
    case "snapshot":
      return renderSnapshot(p);
    case "stackedBar":
    case "line":
    case "multiline":
    case "donut":
    case "funnel":
    case "hbar":
      return `<section class="panel"><h2>${esc(p.title)}</h2>${
        p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
      }<canvas id="c-${p.id}"></canvas>
      <script>window.__PANELS=window.__PANELS||{};window.__PANELS[${JSON.stringify(
        p.id
      )}]={kind:${JSON.stringify(p.kind)},rows:${dataJson}};</script></section>`;
    case "table": {
      const head = (p.columns ?? []).map((c) => `<th>${esc(c)}</th>`).join("");
      const clickable = p.id === "roster";
      const body = rows
        .map((r) => {
          const cells = (r as unknown[]).map((v) => `<td>${esc(v)}</td>`).join("");
          if (clickable) {
            const user = esc((r as unknown[])[0]);
            return `<tr class="rowlink" data-user="${user}" title="Click for advanced metrics + prompts">${cells}</tr>`;
          }
          return `<tr>${cells}</tr>`;
        })
        .join("");
      const hint = clickable ? ' <span class="hint">(click a row →)</span>' : "";
      return `<section class="panel${p.wide ? " full" : ""}"><h2>${esc(p.title)}${hint}</h2>${
        p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
      }<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
    }
    case "friction": {
      const cards = rows
        .map((r) => {
          const [ts, user, category, severity, tool, quote, details] = r as string[];
          return `<div class="fcard sev-${esc(severity)}">
            <div class="fmeta"><span class="badge">${esc(severity)}</span>
              <span class="cat">${esc(category)}</span>
              <span class="when">${esc(ts)}</span></div>
            <blockquote>${esc(quote)}</blockquote>
            <div class="fwho">${esc(user)}${tool ? ` · <code>${esc(tool)}</code>` : ""}</div>
            ${details ? `<details><summary>details</summary><p>${esc(details)}</p></details>` : ""}
          </div>`;
        })
        .join("");
      return `<section class="panel"><h2>${esc(p.title)}</h2>${
        p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ""
      }<div class="friction">${cards || '<p class="sub">No friction reports in window.</p>'}</div></section>`;
    }
  }
}

function renderHTML(
  panels: Panel[],
  userDetails: Record<string, UserDetail> = {},
  generatedAt: string = new Date().toISOString()
): string {
  const body = panels.map(renderPanel).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MCP Telemetry Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  header{padding:24px 32px;border-bottom:1px solid #21262d}
  header h1{margin:0;font-size:20px}
  header .meta{color:#8b949e;font-size:13px;margin-top:4px}
  main{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:20px;padding:24px 32px}
  .panel{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:18px 20px;overflow:hidden}
  .panel h2{margin:0 0 2px;font-size:15px}
  .panel .sub{margin:0 0 14px;color:#8b949e;font-size:12px}
  canvas{max-height:300px}
  /* Date-range controls */
  .ranger{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
  .ranger .presets{display:flex;gap:6px}
  .ranger button.preset{background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:4px 11px;font-size:12px;cursor:pointer}
  .ranger button.preset:hover{border-color:#58a6ff}
  .ranger button.preset.active{background:#1f6feb;border-color:#1f6feb}
  .ranger label{color:#8b949e;font-size:12px;display:flex;align-items:center;gap:4px}
  .ranger input[type=date]{background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:3px 6px;font-size:12px;color-scheme:dark}
  .ranger button.apply{background:#238636;border:1px solid #2ea043;color:#fff;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}
  .ranger button.apply:hover{background:#2ea043}
  /* Snapshot stat cards */
  .snap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .snap-card{background:#11161d;border:1px solid #21262d;border-top:3px solid #6e7681;border-radius:10px;padding:16px 18px}
  .snap-tier{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
  .snap-big{font-size:34px;font-weight:700;line-height:1.1;margin:6px 0 2px}
  .snap-big .snap-unit{display:block;font-size:11px;font-weight:400;color:#8b949e;letter-spacing:0;text-transform:none}
  .snap-new{font-size:13px;color:#3fb950}
  .tablewrap{overflow-x:auto;max-height:520px;overflow-y:auto}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #21262d;white-space:nowrap}
  th{color:#8b949e;font-weight:600}
  tbody tr:hover{background:#1c2230}
  code{background:#21262d;padding:1px 5px;border-radius:4px;font-size:12px}
  .friction{display:flex;flex-direction:column;gap:12px;max-height:520px;overflow:auto}
  .fcard{background:#11161d;border:1px solid #21262d;border-left:3px solid #6e7681;border-radius:8px;padding:12px 14px}
  .fcard.sev-high{border-left-color:#f85149}
  .fcard.sev-medium{border-left-color:#d29922}
  .fcard.sev-low{border-left-color:#3fb950}
  .fmeta{display:flex;gap:10px;align-items:center;font-size:12px;color:#8b949e;margin-bottom:6px}
  .badge{text-transform:uppercase;font-size:10px;letter-spacing:.5px;background:#21262d;padding:2px 6px;border-radius:4px;color:#e6edf3}
  .fcard blockquote{margin:6px 0;font-style:italic;color:#e6edf3}
  .fwho{font-size:12px;color:#8b949e}
  details{margin-top:6px;font-size:12px;color:#8b949e}
  .full{grid-column:1/-1}
  .hint{font-size:11px;color:#58a6ff;font-weight:400}
  tr.rowlink{cursor:pointer}
  tr.rowlink:hover{background:#1f6feb22}
  header .lastref{color:#3fb950}
  #refreshbtn{margin-left:10px;background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer}
  #refreshbtn:hover{background:#30363d;border-color:#58a6ff}
  #refreshbtn:disabled{opacity:.6;cursor:default}
  /* Modal */
  .modal-bg{position:fixed;inset:0;background:#000a;display:none;z-index:50;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}
  .modal-bg.open{display:flex}
  .modal{background:#0d1117;border:1px solid #30363d;border-radius:12px;max-width:920px;width:100%;padding:24px 28px;box-shadow:0 16px 48px #000a}
  .modal h2{margin:0 0 2px;font-size:18px}
  .modal .muser{color:#8b949e;font-size:13px;margin-bottom:16px;word-break:break-all}
  .modal .close{float:right;cursor:pointer;color:#8b949e;font-size:22px;line-height:1;border:none;background:none}
  .modal .close:hover{color:#fff}
  .stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
  .stat{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:10px 14px;min-width:84px}
  .stat .n{font-size:18px;font-weight:600}
  .stat .l{font-size:11px;color:#8b949e}
  .modal h3{font-size:13px;color:#8b949e;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.5px}
  .prompts{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto}
  .prompt{background:#11161d;border:1px solid #21262d;border-radius:8px;padding:9px 12px;font-size:13px}
  .prompt.fail{border-left:3px solid #f85149}
  .prompt .pmeta{font-size:11px;color:#8b949e;margin-bottom:3px;display:flex;gap:8px;flex-wrap:wrap}
  .prompt .err{color:#f85149}
</style></head>
<body>
<header><h1>MCP Telemetry Dashboard</h1>
<div class="meta">PostHog project ${esc(PROJECT_ID)} · range <strong>${esc(
    START
  )} → ${esc(END)}</strong> · Last refreshed <span class="lastref" id="lastref" data-ts="${esc(
    generatedAt
  )}">just now</span> <button id="refreshbtn" title="Query PostHog now">↻ Refresh now</button></div>
<div class="ranger">
  <div class="presets">
    <button class="preset" data-days="7">7d</button>
    <button class="preset" data-days="30">30d</button>
    <button class="preset" data-days="90">90d</button>
    <button class="preset" data-days="365">1y</button>
    <button class="preset" data-days="3650">All</button>
  </div>
  <label>From <input type="date" id="r-start" value="${esc(START)}"></label>
  <label>To <input type="date" id="r-end" value="${esc(END)}"></label>
  <button class="apply" id="r-apply">Apply range</button>
</div></header>
<main>${body}</main>
<div class="modal-bg" id="modal-bg"><div class="modal" id="modal"></div></div>
<script>window.__USERS=${JSON.stringify(userDetails)};</script>
<script>
const C={text:'#8b949e',grid:'#21262d',ok:'#3fb950',fail:'#f85149',blue:'#58a6ff',amber:'#d29922',palette:['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#39c5cf','#ff7b72','#79c0ff']};
Chart.defaults.color=C.text;Chart.defaults.borderColor=C.grid;Chart.defaults.font.size=11;
const P=window.__PANELS||{};
function mk(id){const c=document.getElementById('c-'+id);if(!c||!P[id])return;const {kind,rows}=P[id];
 if(kind==='stackedBar'){new Chart(c,{type:'bar',data:{labels:rows.map(r=>r[0]),datasets:[{label:'OK',data:rows.map(r=>r[1]),backgroundColor:C.ok},{label:'Failed',data:rows.map(r=>r[2]),backgroundColor:C.fail}]},options:{responsive:true,scales:{x:{stacked:true,ticks:{autoSkip:false,maxRotation:90,minRotation:45}},y:{stacked:true}},plugins:{legend:{position:'top'}}}});}
 else if(kind==='line'){new Chart(c,{type:'line',data:{labels:rows.map(r=>r[0]),datasets:[{label:'Calls',data:rows.map(r=>r[1]),borderColor:C.blue,backgroundColor:'transparent',tension:.3},{label:'Users',data:rows.map(r=>r[2]),borderColor:C.amber,backgroundColor:'transparent',tension:.3,yAxisID:'y1'}]},options:{responsive:true,scales:{y:{position:'left'},y1:{position:'right',grid:{drawOnChartArea:false}}}}});}
 else if(kind==='multiline'){new Chart(c,{type:'line',data:{labels:rows.map(r=>r[0]),datasets:[{label:'New accounts',data:rows.map(r=>r[1]),borderColor:C.blue,backgroundColor:'transparent',tension:.3},{label:'New subscriptions',data:rows.map(r=>r[2]),borderColor:C.ok,backgroundColor:'transparent',tension:.3},{label:'Top-ups',data:rows.map(r=>r[3]),borderColor:C.amber,backgroundColor:'transparent',tension:.3}]},options:{responsive:true,plugins:{legend:{position:'top'}}}});}
 else if(kind==='donut'){new Chart(c,{type:'doughnut',data:{labels:rows.map(r=>r[0]||'(none)'),datasets:[{data:rows.map(r=>r[1]),backgroundColor:C.palette}]},options:{responsive:true,plugins:{legend:{position:'right'}}}});}
 else if(kind==='funnel'){const order=['mcp update check','mcp update prompted','mcp update install_clicked','mcp update dismissed','mcp version updated'];const m=Object.fromEntries(rows.map(r=>[r[0],r[1]]));new Chart(c,{type:'bar',data:{labels:order.map(o=>o.replace('mcp ','')),datasets:[{label:'count',data:order.map(o=>m[o]||0),backgroundColor:C.palette}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});}
 else if(kind==='hbar'){new Chart(c,{type:'bar',data:{labels:rows.map(r=>r[0]),datasets:[{label:'calls',data:rows.map(r=>r[1]),backgroundColor:C.blue}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});}
}
Object.keys(P).forEach(mk);

// ── Date-range controls ──
// Presets navigate to ?days=N; custom inputs navigate to ?start=&end=.
// The server reads these, regenerates for that range, and serves it.
(function(){
 const qs=new URLSearchParams(location.search);
 const curDays=qs.get('days');
 document.querySelectorAll('button.preset').forEach(b=>{
  if(curDays && b.dataset.days===curDays)b.classList.add('active');
  b.addEventListener('click',()=>{location.search='?days='+b.dataset.days;});
 });
 const apply=document.getElementById('r-apply');
 if(apply)apply.addEventListener('click',()=>{
  const s=document.getElementById('r-start').value, e=document.getElementById('r-end').value;
  if(!s||!e){alert('Pick both a From and a To date.');return;}
  if(s>e){alert('From date must be on or before To date.');return;}
  location.search='?start='+s+'&end='+e;
 });
})();

// ── Live "last refreshed since X" ticker ──
const lastref=document.getElementById('lastref');
const genTs=lastref?new Date(lastref.dataset.ts).getTime():Date.now();
function ago(){const s=Math.max(0,Math.round((Date.now()-genTs)/1000));
 if(s<60)return s+'s ago';const m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s ago';
 const h=Math.floor(m/60);return h+'h '+(m%60)+'m ago';}
function tick(){if(lastref)lastref.textContent=ago();}

// ── Manual "Refresh now" button ──
// Hits the server's /refresh endpoint (kicks a regeneration), then polls until
// the cached page's generation timestamp advances, then reloads.
const refreshBtn=document.getElementById('refreshbtn');
if(refreshBtn){refreshBtn.addEventListener('click',async()=>{
 refreshBtn.disabled=true;const orig=refreshBtn.textContent;refreshBtn.textContent='↻ Refreshing…';
 try{
  // Preserve the current range (?days / ?start&end) on refresh + poll, else the
  // server would regenerate/serve the DEFAULT range instead of what's shown.
  const qs=location.search||'';
  const r=await fetch('/refresh'+qs,{method:'POST'});
  if(r.status===409){refreshBtn.textContent='↻ Already refreshing…';}
  // Poll the live page for a newer data-ts, then reload (regen takes ~30-50s).
  const before=genTs;let waited=0;
  const poll=setInterval(async()=>{
   waited+=3;
   try{
    const html=await (await fetch('/'+qs,{cache:'no-store'})).text();
    const m=html.match(/data-ts="([^"]+)"/);
    const newTs=m?new Date(m[1]).getTime():before;
    if(newTs>before){clearInterval(poll);location.reload();return;}
   }catch(e){}
   if(waited>=90){clearInterval(poll);refreshBtn.disabled=false;refreshBtn.textContent=orig;}
  },3000);
 }catch(e){refreshBtn.disabled=false;refreshBtn.textContent=orig;}
});}
tick();setInterval(tick,1000);

// ── Per-user drill-down modal ──
const U=window.__USERS||{};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const bg=document.getElementById('modal-bg'),modal=document.getElementById('modal');
function closeModal(){bg.classList.remove('open');}
bg.addEventListener('click',e=>{if(e.target===bg)closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
function openUser(user){
 const d=U[user];
 if(!d){modal.innerHTML='<button class="close">&times;</button><h2>'+esc(user)+'</h2><p class="muser">No detailed metrics captured for this user.</p>';bg.classList.add('open');modal.querySelector('.close').onclick=closeModal;return;}
 const s=d.summary;
 const stat=(n,l)=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';
 const succ=s.calls?Math.round(100*s.ok/s.calls):0;
 let html='<button class="close">&times;</button>';
 const regLine=d.registeredAt?'registered '+esc(d.registeredAt.slice(0,10))+' · ':'';
 html+='<h2>'+esc(user)+'</h2><div class="muser">'+regLine+'first MCP use '+esc(s.firstSeen)+' · last seen '+esc(s.lastSeen)+'</div>';
 html+='<div class="stats">'+stat(s.calls,'tool calls')+stat(succ+'%','success')+stat(s.failed,'failed')+stat(s.tools,'distinct tools')+'</div>';
 // ── Plan & credits ──
 const bl=d.billing||{};
 const planLabel=bl.plan?bl.plan:(bl.freemium==='true'?'FREEMIUM':(bl.freemium==='false'?'PAID':'—'));
 const euros=c=>'€'+(Number(c||0)/100).toFixed(0);
 html+='<h3>Plan &amp; credits</h3>';
 html+='<div class="stats">'+stat(esc(planLabel),'plan')+stat(esc(bl.status||'—'),'billing')
   +stat(d.topups&&d.topups.count?euros(d.topups.totalCents):'€0','topped up')
   +stat(d.topups?d.topups.count:0,'top-ups')+'</div>';
 if(bl.resetsAt)html+='<div class="muser">quota window resets: '+esc(bl.resetsAt)+'</div>';
 // credit-consumption pressure (quota_exceeded hits) — NOT an exact balance
 if(d.quotaHits&&d.quotaHits.length){
  html+='<div class="muser" style="margin-top:8px">Credit pressure — when they hit a quota wall (consumption, not a balance):</div>';
  html+='<div class="tablewrap"><table><thead><tr><th>Resource</th><th>Window</th><th>Times hit</th></tr></thead><tbody>';
  d.quotaHits.forEach(r=>{html+='<tr><td>'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td>'+r[2]+'</td></tr>';});
  html+='</tbody></table></div>';
 } else { html+='<div class="muser" style="margin-top:8px">No quota walls hit in window — credits comfortably within budget.</div>'; }
 // tool breakdown
 html+='<h3>Tools used</h3><div class="tablewrap"><table><thead><tr><th>Tool</th><th>Calls</th><th>OK</th><th>Failed</th><th>Avg ms</th></tr></thead><tbody>';
 d.byTool.forEach(r=>{html+='<tr><td>'+esc(r[0])+'</td><td>'+r[1]+'</td><td>'+r[2]+'</td><td>'+r[3]+'</td><td>'+esc(r[4])+'</td></tr>';});
 html+='</tbody></table></div>';
 // errors
 if(d.errors&&d.errors.length){html+='<h3>Errors</h3><div class="tablewrap"><table><thead><tr><th>Tool</th><th>Error code</th><th>Count</th></tr></thead><tbody>';
  d.errors.forEach(r=>{html+='<tr><td>'+esc(r[0])+'</td><td class="err">'+esc(r[1])+'</td><td>'+r[2]+'</td></tr>';});
  html+='</tbody></table></div>';}
 // prompts
 html+='<h3>Prompts ('+(d.prompts?d.prompts.length:0)+')</h3>';
 if(d.prompts&&d.prompts.length){html+='<div class="prompts">';
  d.prompts.forEach(r=>{const ok=r[2]===true||r[2]==='true';
   html+='<div class="prompt'+(ok?'':' fail')+'"><div class="pmeta"><span>'+esc(r[0])+'</span><code>'+esc(r[1])+'</code>'+(r[3]?'<span class="err">'+esc(r[3])+'</span>':'')+'</div>'+esc(r[4])+'</div>';});
  html+='</div>';}
 else{html+='<p class="sub">No prompts captured (this user\\'s client didn\\'t pass _triggered_by).</p>';}
 modal.innerHTML=html;
 modal.querySelector('.close').onclick=closeModal;
 bg.classList.add('open');
}
document.querySelectorAll('tr.rowlink').forEach(tr=>{tr.addEventListener('click',()=>openUser(tr.dataset.user));});
</script>
</body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
