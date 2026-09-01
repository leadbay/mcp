/**
 * In-process record of imports whose mapping commit failed.
 *
 * product#4007: when a blocking import times out during preprocess, a detached
 * finisher sends `update_mappings` on its behalf. If the backend REJECTS that
 * commit — an invalid mapping, say — the wizard row is left in a state that is
 * byte-identical to one still being committed: `pre_processing.finished` true,
 * `processing` absent, `total_records` 0, and no error field anywhere (probed
 * on us-staging 2026-09-02). `leadbay_import_status` would then report
 * `phase: "committing"` forever and the agent would poll forever.
 *
 * Before the timeout became a success result, this case surfaced as a plain
 * error, so leaving it silent would be a regression. The finisher records the
 * failure here and `leadbay_import_status` reports it as `failed` with the
 * backend's own message.
 *
 * Deliberately memory-only and best-effort: a restart loses it and the caller
 * simply falls back to the pre-existing "still committing" reading. It is NOT
 * a job store — the BulkTracker is, and the hosted MCP has none, which is
 * exactly why this path has to work without one. Keyed by importId, which is
 * already a capability the caller holds.
 */

const MAX_ENTRIES = 500;
const failures = new Map<string, string>();

export function recordCommitFailure(importId: string, reason: string): void {
  // Bounded so a long-lived server can't grow this without limit; oldest out
  // first, since a stale failure is the least useful thing to keep.
  if (failures.size >= MAX_ENTRIES) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(importId, reason);
}

export function commitFailureFor(importIds: string[]): string | undefined {
  for (const id of importIds) {
    const reason = failures.get(id);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

export function clearCommitFailures(): void {
  failures.clear();
}
