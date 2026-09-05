/**
 * In-process double-launch guard.
 *
 * This is all that remains of the old BulkTracker, and it is deliberately not a
 * store. Job state lives on the backend — every launch returns a
 * `notification_id` the backend mints, retains for 30 days and scopes to the
 * organization, so nothing here needs to persist, survive a restart, or be
 * shared between processes.
 *
 * The one thing a launcher genuinely cannot get from the backend is "did I
 * already fire this exact request seconds ago". An agent retry inside that
 * window would spend quota twice. So we remember the fingerprint of a launch
 * and the id it produced, for five minutes, in memory.
 *
 * Losing this map on a restart costs at most one duplicate launch inside a
 * five-minute window. That is the correct trade for not owning a datastore.
 */

import { createHash } from "node:crypto";

const WINDOW_MS = 5 * 60 * 1000;

// Bounded so a long-lived hosted process cannot grow this without limit.
// Entries expire in 5 minutes; the cap only matters under a burst.
const MAX_ENTRIES = 1000;

export interface LaunchRecord {
  notification_id: string | null;
  // Claimed but not yet settled. A concurrent caller must not launch; a caller
  // that crashes must clear it via abandonLaunch.
  in_flight?: boolean;
  // Backend file-import ids, for the import flow — its handle is importIds
  // rather than a notification.
  import_ids?: string[];
  launched_at: string;
  at: number;
}

const recent = new Map<string, LaunchRecord>();

export function launchFingerprint(parts: Array<string | number | boolean | string[]>): string {
  const flat = parts
    .map((p) => (Array.isArray(p) ? [...p].sort().join(",") : String(p)))
    .join("|");
  return createHash("sha256").update(flat).digest("hex");
}

function sweep(now: number): void {
  for (const [k, v] of recent) {
    if (now - v.at >= WINDOW_MS) recent.delete(k);
  }
}

/**
 * Claim the fingerprint BEFORE launching, so a concurrent identical call sees
 * the claim instead of launching too. Returns the earlier launch if there is
 * one, or undefined — in which case the caller owns the claim and MUST call
 * either `rememberLaunch` or `abandonLaunch`.
 *
 * The claim is what closes both halves of product#4039: recording only after a
 * successful launch leaves a window where two callers both launch, and
 * recording before leaves a failed launch poisoning the window so a retry is
 * told it already ran when nothing did.
 */
export type LaunchClaim =
  // Nobody else holds this fingerprint. The caller MUST launch, then settle
  // with rememberLaunch or drop with abandonLaunch.
  | { state: "owned" }
  // A launch for the same inputs is in flight RIGHT NOW in this process. It has
  // no ids yet, so there is nothing to hand back — saying "running" here with an
  // empty handle is worse than saying nothing, because on hosted the returned
  // ids are the only way back to the job.
  | { state: "in_flight"; seconds_since: number }
  // A launch already completed inside the window; its ids are reusable.
  | { state: "settled"; record: LaunchRecord & { seconds_since: number } };

export function beginLaunch(
  fingerprint: string,
  now: number = Date.now()
): LaunchClaim {
  const prior = recallLaunch(fingerprint, now);
  if (prior) {
    // in_flight is the discriminator, and it has to be READ. Treating a claim
    // as a settled launch is what produced `status:"running"` with a null
    // notification_id / empty importIds.
    return prior.in_flight
      ? { state: "in_flight", seconds_since: prior.seconds_since }
      : { state: "settled", record: prior };
  }
  recent.set(fingerprint, {
    notification_id: null,
    in_flight: true,
    launched_at: new Date(now).toISOString(),
    at: now,
  });
  return { state: "owned" };
}

/** The launch failed. Drop the claim so an identical retry really launches. */
export function abandonLaunch(fingerprint: string): void {
  const held = recent.get(fingerprint);
  if (held?.in_flight) recent.delete(fingerprint);
}

/** The launch already made within the window, or undefined. */
export function recallLaunch(
  fingerprint: string,
  now: number = Date.now()
): (LaunchRecord & { seconds_since: number }) | undefined {
  sweep(now);
  const hit = recent.get(fingerprint);
  if (!hit) return undefined;
  return { ...hit, seconds_since: Math.round((now - hit.at) / 1000) };
}

export function rememberLaunch(
  fingerprint: string,
  notificationId: string | null,
  now: number = Date.now(),
  importIds?: string[]
): LaunchRecord {
  sweep(now);
  while (recent.size >= MAX_ENTRIES) {
    const oldest = recent.keys().next();
    if (oldest.done) break;
    recent.delete(oldest.value);
  }
  const rec: LaunchRecord = {
    notification_id: notificationId,
    in_flight: false,
    ...(importIds ? { import_ids: importIds } : {}),
    launched_at: new Date(now).toISOString(),
    at: now,
  };
  recent.set(fingerprint, rec);
  return rec;
}

/** Test-only: the map is module state. */
export function resetLaunchGuard(): void {
  recent.clear();
}
