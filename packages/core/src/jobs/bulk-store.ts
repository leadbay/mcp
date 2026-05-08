/**
 * BulkTracker — composite-facing contract for tracking bulk contact enrichments
 * while the Leadbay backend doesn't yet issue a real bulk_id.
 *
 * Two-phase launch ordering (enrich-titles calls these in order):
 *   1. findOrCreatePending({...})  — reserves a slot atomically, returns existing
 *                                    record if an identical fingerprint exists
 *                                    within the idempotency window.
 *   2. caller POSTs backend /launch
 *   3a. on 2xx: markLaunched(bulk_id)
 *   3b. on error: markFailed(bulk_id)
 *
 * The pending record acts as the serialization point so two concurrent identical
 * launches can't both reach /launch.
 *
 * The wire-shape of BulkRecord mirrors what we expect the backend to eventually
 * return, so the `BulkTracker` contract survives the RemoteBulkStore swap.
 *
 * Cross-process safety is out of scope — MCP runs single-process.
 */

import {
  mkdir as mkdirAsync,
  lstat,
  open as fsOpen,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { homedir, platform } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { ToolLogger } from "../types.js";

// ─── Public types ───────────────────────────────────────────────────────────

// Two record kinds today: enrich (legacy, default if `kind` absent on disk)
// and qualify (new in 0.4.x for import_and_qualify). Both share the same
// state machine and storage backing — only the payload-shape differs.
export type BulkRecordKind = "enrich" | "qualify";

// Common spine across kinds. Concrete shapes extend this with kind-specific
// fields. `kind` is optional on disk for backward-compat with rows written
// before 0.4.x (default to "enrich" on read).
interface BulkRecordCommon {
  bulk_id: string; // client-minted UUIDv4 (future: server-minted)
  launched_at: string; // ISO string
  lead_ids: string[]; // sorted, deduplicated
  // pending = launch POST in flight. launched = backend acknowledged.
  // failed = launch POST failed; no work was actually started.
  // cancelled = ctx.signal aborted mid-flight (iter-21); the bulk was
  // either never launched OR the polling loop exited; readers (status
  // tools) should surface BULK_CANCELLED so the agent stops polling.
  status: "pending" | "launched" | "failed" | "cancelled";
  idempotency_key: string; // sha256 over sorted inputs
  durability: "file" | "memory";
}

export interface EnrichBulkRecord extends BulkRecordCommon {
  kind: "enrich";
  titles: string[]; // sorted, deduplicated
  email: boolean;
  phone: boolean;
  lens_id: number;
  selection_source: "explicit" | "wishlist";
}

export interface QualifyBulkRecord extends BulkRecordCommon {
  kind: "qualify";
  // import-and-qualify launches one or more underlying file-imports; tracking
  // them lets the status tool surface "what's still mid-import vs mid-qualify"
  // and lets the agent re-fetch the wizard's records page if it cares.
  import_ids: string[];
  lens_id: number;
  // Caller-supplied budgets at launch time. Repeated by the status tool.
  per_lead_budget_ms?: number;
  total_budget_ms?: number;
}

export type BulkRecord = EnrichBulkRecord | QualifyBulkRecord;

export interface FindOrCreatePendingArgs {
  lead_ids: string[];
  titles: string[];
  email: boolean;
  phone: boolean;
  lens_id: number;
  selection_source: "explicit" | "wishlist";
  idempotency_window_ms?: number;
}

export interface FindOrCreatePendingQualifyArgs {
  lead_ids: string[];
  import_ids: string[];
  lens_id: number;
  // Mapping fingerprint contributes to the idempotency key — two calls with
  // the same leadIds + same mapping (re-runs of the same input file) reuse
  // the same qualify_id within the idempotency window.
  mapping_fingerprint: string;
  per_lead_budget_ms?: number;
  total_budget_ms?: number;
  idempotency_window_ms?: number;
}

export interface BulkTracker {
  findOrCreatePending(args: FindOrCreatePendingArgs): Promise<{
    record: EnrichBulkRecord;
    reused: boolean;
    seconds_since_original?: number;
  }>;
  findOrCreatePendingQualify(args: FindOrCreatePendingQualifyArgs): Promise<{
    record: QualifyBulkRecord;
    reused: boolean;
    seconds_since_original?: number;
  }>;
  markLaunched(bulk_id: string): Promise<BulkRecord>;
  markFailed(bulk_id: string): Promise<void>;
  // iter-21: terminal-state transition for ctx.signal aborts. Idempotent —
  // safe to call repeatedly OR on an already-cancelled / non-existent record.
  // Status-poller composites (bulk_enrich_status, qualify_status) surface
  // cancelled records as BULK_CANCELLED error envelopes so the agent stops
  // polling.
  markCancelled(bulk_id: string): Promise<void>;
  get(bulk_id: string): Promise<BulkRecord | undefined>;
  // Typed accessor — returns undefined when the record exists but is the
  // wrong kind. Saves callers from repeating the type narrowing.
  getQualify(bulk_id: string): Promise<QualifyBulkRecord | undefined>;
  list(): Promise<BulkRecord[]>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UUIDV4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidBulkId(v: unknown): v is string {
  return typeof v === "string" && UUIDV4_RE.test(v);
}

function computeIdempotencyKey(args: {
  lead_ids: string[];
  titles: string[];
  email: boolean;
  phone: boolean;
  lens_id: number;
}): string {
  const parts = [
    [...args.lead_ids].sort().join(","),
    [...args.titles].sort().join(","),
    args.email ? "e1" : "e0",
    args.phone ? "p1" : "p0",
    `l${args.lens_id}`,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function computeQualifyIdempotencyKey(args: {
  lead_ids: string[];
  import_ids: string[];
  lens_id: number;
  mapping_fingerprint: string;
}): string {
  // Distinct domain prefix from enrich's key so a hash collision is
  // impossible across kinds.
  const parts = [
    "qualify",
    [...args.lead_ids].sort().join(","),
    [...args.import_ids].sort().join(","),
    `l${args.lens_id}`,
    args.mapping_fingerprint,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function normalizeLaunchInputs(args: {
  lead_ids: string[];
  titles: string[];
}): { lead_ids: string[]; titles: string[] } {
  return {
    lead_ids: [...new Set(args.lead_ids)].sort(),
    titles: [...new Set(args.titles)].sort(),
  };
}

// ─── Async mutex (promise-chained wait queue) ───────────────────────────────

class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  unlock(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await fn();
    } finally {
      this.unlock();
    }
  }
}

// ─── LocalBulkStore — file or memory backend ────────────────────────────────

export interface LocalBulkStoreOpts {
  backend: "file" | "memory";
  path?: string; // required if backend === "file"
  logger?: ToolLogger;
  allowMemoryFallback?: boolean; // LEADBAY_BULK_STORE_ALLOW_MEMORY=1
  allowUnsafePath?: boolean; // LEADBAY_BULK_STORE_PATH_UNSAFE=1 — disable $HOME rooting
  now?: () => number; // injectable for tests
}

export class LocalBulkStore implements BulkTracker {
  private readonly backend: "file" | "memory";
  private readonly path?: string;
  private readonly logger?: ToolLogger;
  private readonly allowUnsafePath: boolean;
  private readonly now: () => number;
  private readonly mutex = new AsyncMutex();
  private memory: BulkRecord[] = [];
  // Cached file resolution — computed lazily on first access.
  private initialized = false;

  constructor(opts: LocalBulkStoreOpts) {
    this.backend = opts.backend;
    this.logger = opts.logger;
    this.allowUnsafePath = !!opts.allowUnsafePath;
    this.now = opts.now ?? Date.now;
    if (this.backend === "file") {
      if (!opts.path) {
        throw new Error("LocalBulkStore: path is required when backend=file");
      }
      this.path = resolvePath(opts.path);
      this.validatePath(this.path);
    }
  }

  get durability(): "file" | "memory" {
    return this.backend;
  }

  // Exposed for tests and ops tooling.
  get resolvedPath(): string | undefined {
    return this.path;
  }

  private validatePath(p: string): void {
    if (this.allowUnsafePath) return;
    const home = resolvePath(homedir());
    // p must be within $HOME. resolvePath removed any trailing /.
    if (p !== home && !p.startsWith(home + "/") && !p.startsWith(home + "\\")) {
      throw new Error(
        `LocalBulkStore: path ${p} is outside $HOME (${home}). ` +
          `Set LEADBAY_BULK_STORE_PATH_UNSAFE=1 to override.`
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized || this.backend !== "file") {
      this.initialized = true;
      return;
    }
    const dir = dirname(this.path!);
    // mkdir 0700 — user-only. recursive:true tolerates existing.
    await mkdirAsync(dir, { recursive: true, mode: 0o700 });
    // lstat target: if exists and is a symlink, reject.
    try {
      const st = await lstat(this.path!);
      if (st.isSymbolicLink()) {
        throw new Error(
          `LocalBulkStore: refusing to use ${this.path} — path is a symlink. ` +
            `Set LEADBAY_BULK_STORE_PATH_UNSAFE=1 to override.`
        );
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
      // ENOENT is fine — file will be created on first write.
    }
    this.initialized = true;
  }

  // ─── Storage layer (file or memory) ──────────────────────────────────────

  private async readAll(): Promise<BulkRecord[]> {
    if (this.backend === "memory") return [...this.memory];
    await this.ensureInitialized();
    let raw: string;
    try {
      raw = await readFile(this.path!, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      this.logger?.warn?.(
        `bulk.record_dropped file_parse_failed ${err?.message ?? err}`
      );
      return [];
    }
    if (!Array.isArray(parsed)) {
      this.logger?.warn?.("bulk.record_dropped file_not_array");
      return [];
    }
    const out: BulkRecord[] = [];
    for (const entry of parsed) {
      try {
        out.push(this.validateRecord(entry));
      } catch (err: any) {
        this.logger?.warn?.(
          `bulk.record_dropped invalid_record ${err?.message ?? err}`
        );
      }
    }
    return out;
  }

  private validateRecord(raw: unknown): BulkRecord {
    if (!raw || typeof raw !== "object") throw new Error("not an object");
    const r = raw as Record<string, unknown>;
    if (!isValidBulkId(r.bulk_id)) throw new Error("invalid bulk_id");
    if (typeof r.launched_at !== "string") throw new Error("missing launched_at");
    if (!Array.isArray(r.lead_ids) || !r.lead_ids.every((x) => typeof x === "string"))
      throw new Error("invalid lead_ids");
    if (r.status !== "pending" && r.status !== "launched" && r.status !== "failed")
      throw new Error("invalid status");
    if (typeof r.idempotency_key !== "string") throw new Error("invalid idempotency_key");

    // kind discriminator: default to "enrich" for backward compat with rows
    // written before 0.4.x. Any unknown kind is dropped (warned by readAll).
    const kind = (r.kind as BulkRecordKind | undefined) ?? "enrich";
    if (kind === "qualify") {
      if (!Array.isArray(r.import_ids) || !r.import_ids.every((x) => typeof x === "string"))
        throw new Error("invalid import_ids");
      if (typeof r.lens_id !== "number") throw new Error("invalid lens_id");
      const out: QualifyBulkRecord = {
        kind: "qualify",
        bulk_id: r.bulk_id,
        launched_at: r.launched_at,
        lead_ids: r.lead_ids as string[],
        import_ids: r.import_ids as string[],
        lens_id: r.lens_id,
        status: r.status,
        idempotency_key: r.idempotency_key,
        durability: this.backend,
      };
      if (typeof r.per_lead_budget_ms === "number") out.per_lead_budget_ms = r.per_lead_budget_ms;
      if (typeof r.total_budget_ms === "number") out.total_budget_ms = r.total_budget_ms;
      return out;
    }
    if (kind === "enrich") {
      if (!Array.isArray(r.titles) || !r.titles.every((x) => typeof x === "string"))
        throw new Error("invalid titles");
      if (typeof r.email !== "boolean") throw new Error("invalid email");
      if (typeof r.phone !== "boolean") throw new Error("invalid phone");
      if (typeof r.lens_id !== "number") throw new Error("invalid lens_id");
      if (r.selection_source !== "explicit" && r.selection_source !== "wishlist")
        throw new Error("invalid selection_source");
      return {
        kind: "enrich",
        bulk_id: r.bulk_id,
        launched_at: r.launched_at,
        lead_ids: r.lead_ids as string[],
        titles: r.titles as string[],
        email: r.email,
        phone: r.phone,
        lens_id: r.lens_id,
        selection_source: r.selection_source,
        status: r.status,
        idempotency_key: r.idempotency_key,
        durability: this.backend,
      };
    }
    throw new Error(`unknown kind: ${String(kind)}`);
  }

  private async writeAll(records: BulkRecord[]): Promise<void> {
    if (this.backend === "memory") {
      this.memory = records.map((r) =>
        ({ ...r, durability: "memory" as const }) as BulkRecord
      );
      return;
    }
    await this.ensureInitialized();
    // Stamp durability "file" on every record we persist.
    const payload = records.map((r) => ({ ...r, durability: "file" as const }));
    const json = JSON.stringify(payload, null, 2);
    const tmp = this.path! + ".tmp";
    // Create exclusively (wx) at 0600 to avoid clobbering someone else's tmp.
    // If a stale tmp from a crashed run exists, unlink and retry once.
    let fh = await openTmpFileExclusive(tmp);
    try {
      await fh.writeFile(json, { encoding: "utf8" });
      await fh.sync();
    } finally {
      await fh.close();
    }
    // On Windows, rename fails if target exists. POSIX rename is atomic.
    if (platform() === "win32") {
      try {
        await unlink(this.path!);
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
      }
    }
    await rename(tmp, this.path!);
    // Best-effort fsync the directory so the rename is durable.
    try {
      const dirFh = await fsOpen(dirname(this.path!), "r");
      try {
        await dirFh.sync();
      } finally {
        await dirFh.close();
      }
    } catch {
      // Directory fsync fails on some filesystems (Windows). Best-effort only.
    }
  }

  // ─── TTL cleanup ─────────────────────────────────────────────────────────

  private prune(records: BulkRecord[]): BulkRecord[] {
    const cutoff = this.now() - TTL_MS;
    const kept: BulkRecord[] = [];
    for (const r of records) {
      const launched = Date.parse(r.launched_at);
      if (Number.isFinite(launched) && launched >= cutoff) {
        kept.push(r);
      } else {
        this.logger?.info?.(
          `bulk.ttl_dropped bulk_id=${r.bulk_id} launched_at=${r.launched_at}`
        );
      }
    }
    return kept;
  }

  // ─── BulkTracker API ────────────────────────────────────────────────────

  async findOrCreatePending(
    args: FindOrCreatePendingArgs
  ): Promise<{ record: EnrichBulkRecord; reused: boolean; seconds_since_original?: number }> {
    const { lead_ids, titles } = normalizeLaunchInputs(args);
    const idempotency_key = computeIdempotencyKey({
      lead_ids,
      titles,
      email: args.email,
      phone: args.phone,
      lens_id: args.lens_id,
    });
    const window = args.idempotency_window_ms ?? DEFAULT_IDEMPOTENCY_WINDOW_MS;

    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      const nowMs = this.now();
      // Look for a reusable match: same fingerprint, not `failed`, and within
      // the window. Restrict to the enrich kind so cross-kind hash collisions
      // (impossible by domain prefix) cannot leak.
      const existing = all.find(
        (r): r is EnrichBulkRecord =>
          r.kind === "enrich" &&
          r.idempotency_key === idempotency_key &&
          r.status !== "failed" &&
          nowMs - Date.parse(r.launched_at) < window
      );
      if (existing) {
        this.logger?.info?.(
          `bulk.reused bulk_id=${existing.bulk_id} seconds_since_original=${
            Math.round((nowMs - Date.parse(existing.launched_at)) / 1000)
          }`
        );
        return {
          record: existing,
          reused: true,
          seconds_since_original: Math.round(
            (nowMs - Date.parse(existing.launched_at)) / 1000
          ),
        };
      }
      const record: EnrichBulkRecord = {
        kind: "enrich",
        bulk_id: randomUUID(),
        launched_at: new Date(nowMs).toISOString(),
        lead_ids,
        titles,
        email: args.email,
        phone: args.phone,
        lens_id: args.lens_id,
        selection_source: args.selection_source,
        status: "pending",
        idempotency_key,
        durability: this.backend,
      };
      all.push(record);
      await this.writeAll(all);
      this.logger?.info?.(
        `bulk.registered kind=enrich bulk_id=${record.bulk_id} lens_id=${record.lens_id} ` +
          `lead_count=${record.lead_ids.length} titles_count=${record.titles.length} ` +
          `durability=${record.durability}`
      );
      return { record, reused: false };
    });
  }

  async findOrCreatePendingQualify(
    args: FindOrCreatePendingQualifyArgs
  ): Promise<{ record: QualifyBulkRecord; reused: boolean; seconds_since_original?: number }> {
    const lead_ids = [...new Set(args.lead_ids)].sort();
    const import_ids = [...new Set(args.import_ids)].sort();
    const idempotency_key = computeQualifyIdempotencyKey({
      lead_ids,
      import_ids,
      lens_id: args.lens_id,
      mapping_fingerprint: args.mapping_fingerprint,
    });
    const window = args.idempotency_window_ms ?? DEFAULT_IDEMPOTENCY_WINDOW_MS;

    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      const nowMs = this.now();
      const existing = all.find(
        (r): r is QualifyBulkRecord =>
          r.kind === "qualify" &&
          r.idempotency_key === idempotency_key &&
          r.status !== "failed" &&
          nowMs - Date.parse(r.launched_at) < window
      );
      if (existing) {
        this.logger?.info?.(
          `bulk.reused kind=qualify bulk_id=${existing.bulk_id} seconds_since_original=${
            Math.round((nowMs - Date.parse(existing.launched_at)) / 1000)
          }`
        );
        return {
          record: existing,
          reused: true,
          seconds_since_original: Math.round(
            (nowMs - Date.parse(existing.launched_at)) / 1000
          ),
        };
      }
      const record: QualifyBulkRecord = {
        kind: "qualify",
        bulk_id: randomUUID(),
        launched_at: new Date(nowMs).toISOString(),
        lead_ids,
        import_ids,
        lens_id: args.lens_id,
        status: "pending",
        idempotency_key,
        durability: this.backend,
      };
      if (args.per_lead_budget_ms !== undefined) record.per_lead_budget_ms = args.per_lead_budget_ms;
      if (args.total_budget_ms !== undefined) record.total_budget_ms = args.total_budget_ms;
      all.push(record);
      await this.writeAll(all);
      this.logger?.info?.(
        `bulk.registered kind=qualify bulk_id=${record.bulk_id} lens_id=${record.lens_id} ` +
          `lead_count=${record.lead_ids.length} import_count=${record.import_ids.length} ` +
          `durability=${record.durability}`
      );
      return { record, reused: false };
    });
  }

  async getQualify(bulk_id: string): Promise<QualifyBulkRecord | undefined> {
    const r = await this.get(bulk_id);
    return r && r.kind === "qualify" ? r : undefined;
  }

  async markLaunched(bulk_id: string): Promise<BulkRecord> {
    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      const idx = all.findIndex((r) => r.bulk_id === bulk_id);
      if (idx < 0) {
        throw new Error(`bulk_id not found: ${bulk_id}`);
      }
      all[idx] = { ...all[idx], status: "launched" };
      await this.writeAll(all);
      this.logger?.info?.(`bulk.launched bulk_id=${bulk_id}`);
      return all[idx];
    });
  }

  async markFailed(bulk_id: string): Promise<void> {
    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      const idx = all.findIndex((r) => r.bulk_id === bulk_id);
      if (idx < 0) {
        // Best-effort: marking a non-existent bulk failed is a no-op.
        return;
      }
      all[idx] = { ...all[idx], status: "failed" };
      await this.writeAll(all);
      this.logger?.info?.(`bulk.launch_failed bulk_id=${bulk_id}`);
    });
  }

  async markCancelled(bulk_id: string): Promise<void> {
    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      const idx = all.findIndex((r) => r.bulk_id === bulk_id);
      if (idx < 0) {
        // Best-effort: marking a non-existent bulk cancelled is a no-op
        // (the record may have aged out via TTL or never existed). Idempotent.
        return;
      }
      all[idx] = { ...all[idx], status: "cancelled" };
      await this.writeAll(all);
      this.logger?.info?.(`bulk.cancelled bulk_id=${bulk_id}`);
    });
  }

  async get(bulk_id: string): Promise<BulkRecord | undefined> {
    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      return all.find((r) => r.bulk_id === bulk_id);
    });
  }

  async list(): Promise<BulkRecord[]> {
    return this.mutex.run(async () => {
      const all = this.prune(await this.readAll());
      return [...all].sort(
        (a, b) => Date.parse(b.launched_at) - Date.parse(a.launched_at)
      );
    });
  }
}

// ─── Open tmp file exclusively, retrying once if a stale tmp exists ────────

async function openTmpFileExclusive(path: string) {
  try {
    return await fsOpen(
      path,
      fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_EXCL,
      0o600
    );
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      await unlink(path).catch(() => {});
      return fsOpen(
        path,
        fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_EXCL,
        0o600
      );
    }
    throw err;
  }
}

// ─── Convenience: InMemoryBulkStore for tests ───────────────────────────────

export class InMemoryBulkStore extends LocalBulkStore {
  constructor(opts: { logger?: ToolLogger; now?: () => number } = {}) {
    super({ backend: "memory", logger: opts.logger, now: opts.now });
  }
}

// ─── Factory — reads env, decides backend ───────────────────────────────────

export interface CreateDefaultBulkStoreOpts {
  logger?: ToolLogger;
  env?: Record<string, string | undefined>;
}

export async function createDefaultBulkStore(
  opts: CreateDefaultBulkStoreOpts = {}
): Promise<LocalBulkStore> {
  const env = opts.env ?? process.env;
  const allowMemory = env.LEADBAY_BULK_STORE_ALLOW_MEMORY === "1";
  const allowUnsafePath = env.LEADBAY_BULK_STORE_PATH_UNSAFE === "1";
  const path =
    env.LEADBAY_BULK_STORE_PATH ?? resolvePath(homedir(), ".leadbay", "bulks.json");

  try {
    const store = new LocalBulkStore({
      backend: "file",
      path,
      logger: opts.logger,
      allowUnsafePath,
    });
    // Probe: ensure init doesn't throw, and the directory is usable.
    await (store as any).ensureInitialized();
    // Probe a writable permission by attempting to stat the parent.
    await stat(dirname(path));
    return store;
  } catch (err: any) {
    if (!allowMemory) {
      const msg =
        `bulk store init failed at ${path}: ${err?.message ?? err}. ` +
        `Set LEADBAY_BULK_STORE_ALLOW_MEMORY=1 to fall back to in-memory ` +
        `(handles won't survive MCP restart), or set LEADBAY_BULK_STORE_PATH ` +
        `to a writable path.`;
      opts.logger?.error?.(msg);
      throw new Error(msg);
    }
    opts.logger?.warn?.(
      `bulk.fallback_memory path=${path} reason=${err?.message ?? err}`
    );
    return new LocalBulkStore({ backend: "memory", logger: opts.logger });
  }
}
