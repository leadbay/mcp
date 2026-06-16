// Local persistence for the auto-update flow.
//
// Stores: last GitHub check time + the latest known release metadata
// (version, installer asset URL, release page URL, ETag), the list of
// versions the user explicitly skipped, an optional "remind me
// tomorrow" timestamp, and the last version we observed running on
// this host (so we can fire a `mcp_version_updated` event when the
// next process boot sees a newer VERSION constant baked in).
//
// Mirrors the bulk-store.ts pattern: $HOME-rooted path, 0o600 file
// mode, atomic rename via tmpfile, symlink rejection.
//
// Single-process MCP — no cross-process locking needed.

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
import { homedir } from "node:os";
import type { ToolLogger } from "@leadbay/core";

export interface UpdateState {
  /** ms epoch of the last GitHub releases check (success OR failure). */
  last_check_time: number;
  /** semver string, no leading `v`, e.g. "0.10.2". Absent before first successful check. */
  latest_known_version?: string;
  /** Direct download URL for the installer asset (`.dxt`, falling back to `.mcpb`) on the latest release. */
  latest_known_install_url?: string;
  /** HTML release page URL (used as the changelog link in the prompt). */
  latest_known_release_url?: string;
  /** GitHub ETag from the last successful GET. Sent as If-None-Match next time. */
  etag?: string;
  /** Versions the user explicitly chose "skip this version" on. */
  suppressed_versions: string[];
  /** ms epoch — when set & in the future, do not surface any update prompt. */
  remind_until?: number;
  /**
   * The VERSION constant value we observed running on the previous server
   * boot. When the current boot's VERSION differs, we fire `mcp_version_updated`
   * and overwrite this — gives us a true "user updated" conversion event
   * regardless of HOW they installed (mcpb double-click, npm, npx).
   */
  previous_running_version?: string;
}

function emptyState(): UpdateState {
  return {
    last_check_time: 0,
    suppressed_versions: [],
  };
}

export interface UpdateStateStoreOpts {
  backend: "file" | "memory";
  path?: string;
  logger?: ToolLogger;
  allowUnsafePath?: boolean;
  now?: () => number;
}

export class UpdateStateStore {
  private readonly backend: "file" | "memory";
  private readonly path?: string;
  private readonly logger?: ToolLogger;
  private readonly allowUnsafePath: boolean;
  private readonly now: () => number;
  private memory: UpdateState = emptyState();
  private initialized = false;

  constructor(opts: UpdateStateStoreOpts) {
    this.backend = opts.backend;
    this.logger = opts.logger;
    this.allowUnsafePath = !!opts.allowUnsafePath;
    this.now = opts.now ?? Date.now;
    if (this.backend === "file") {
      if (!opts.path) {
        throw new Error("UpdateStateStore: path is required when backend=file");
      }
      this.path = resolvePath(opts.path);
      this.validatePath(this.path);
    }
  }

  get durability(): "file" | "memory" {
    return this.backend;
  }

  get resolvedPath(): string | undefined {
    return this.path;
  }

  private validatePath(p: string): void {
    if (this.allowUnsafePath) return;
    const home = resolvePath(homedir());
    if (p !== home && !p.startsWith(home + "/") && !p.startsWith(home + "\\")) {
      throw new Error(
        `UpdateStateStore: path ${p} is outside $HOME (${home}). ` +
          `Set LEADBAY_UPDATE_STATE_PATH_UNSAFE=1 to override.`
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized || this.backend !== "file") {
      this.initialized = true;
      return;
    }
    const dir = dirname(this.path!);
    await mkdirAsync(dir, { recursive: true, mode: 0o700 });
    try {
      const st = await lstat(this.path!);
      if (st.isSymbolicLink()) {
        throw new Error(
          `UpdateStateStore: refusing to use ${this.path} — path is a symlink. ` +
            `Set LEADBAY_UPDATE_STATE_PATH_UNSAFE=1 to override.`
        );
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    this.initialized = true;
  }

  async read(): Promise<UpdateState> {
    if (this.backend === "memory") return { ...this.memory, suppressed_versions: [...this.memory.suppressed_versions] };
    await this.ensureInitialized();
    let raw: string;
    try {
      raw = await readFile(this.path!, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return emptyState();
      throw err;
    }
    try {
      const parsed = JSON.parse(raw);
      return this.validate(parsed);
    } catch (err: any) {
      this.logger?.warn?.(
        `update_state.parse_failed ${err?.message ?? err}; resetting to empty`
      );
      return emptyState();
    }
  }

  async write(state: UpdateState): Promise<void> {
    if (this.backend === "memory") {
      this.memory = { ...state, suppressed_versions: [...state.suppressed_versions] };
      return;
    }
    await this.ensureInitialized();
    const tmp = `${this.path!}.tmp.${process.pid}.${this.now()}`;
    const handle = await openTmpFileExclusive(tmp);
    try {
      await handle.writeFile(JSON.stringify(state, null, 2));
    } finally {
      await handle.close();
    }
    await rename(tmp, this.path!);
  }

  /**
   * Apply a partial mutation atomically (read → merge → write). Caller
   * passes a function so concurrent mutators (the startup check + a
   * tool call landing during it) compose without dropping fields.
   */
  async update(mutator: (cur: UpdateState) => UpdateState): Promise<UpdateState> {
    const cur = await this.read();
    const next = mutator(cur);
    await this.write(next);
    return next;
  }

  private validate(raw: unknown): UpdateState {
    if (!raw || typeof raw !== "object") return emptyState();
    const r = raw as Record<string, unknown>;
    const out: UpdateState = emptyState();
    if (typeof r.last_check_time === "number" && Number.isFinite(r.last_check_time)) {
      out.last_check_time = r.last_check_time;
    }
    if (typeof r.latest_known_version === "string") {
      out.latest_known_version = r.latest_known_version;
    }
    // Forward-migrate the legacy `latest_known_mcpb_url` key written by
    // pre-rename versions — the new key wins when both are present.
    if (typeof r.latest_known_install_url === "string") {
      out.latest_known_install_url = r.latest_known_install_url;
    } else if (typeof r.latest_known_mcpb_url === "string") {
      out.latest_known_install_url = r.latest_known_mcpb_url;
    }
    if (typeof r.latest_known_release_url === "string") {
      out.latest_known_release_url = r.latest_known_release_url;
    }
    if (typeof r.etag === "string") out.etag = r.etag;
    if (Array.isArray(r.suppressed_versions)) {
      out.suppressed_versions = r.suppressed_versions.filter(
        (v): v is string => typeof v === "string"
      );
    }
    if (typeof r.remind_until === "number" && Number.isFinite(r.remind_until)) {
      out.remind_until = r.remind_until;
    }
    if (typeof r.previous_running_version === "string") {
      out.previous_running_version = r.previous_running_version;
    }
    return out;
  }
}

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

export interface CreateDefaultUpdateStateStoreOpts {
  logger?: ToolLogger;
  env?: Record<string, string | undefined>;
}

export async function createDefaultUpdateStateStore(
  opts: CreateDefaultUpdateStateStoreOpts = {}
): Promise<UpdateStateStore> {
  const env = opts.env ?? process.env;
  const allowUnsafePath = env.LEADBAY_UPDATE_STATE_PATH_UNSAFE === "1";
  const path =
    env.LEADBAY_UPDATE_STATE_PATH ??
    resolvePath(homedir(), ".leadbay", "update-state.json");

  try {
    const store = new UpdateStateStore({
      backend: "file",
      path,
      logger: opts.logger,
      allowUnsafePath,
    });
    // Probe — ensure init doesn't throw + parent dir is statable.
    await (store as any).ensureInitialized();
    await stat(dirname(path));
    return store;
  } catch (err: any) {
    // Auto-update is a UX nicety, not a correctness invariant — fall back
    // to memory rather than crashing the MCP server when ~/.leadbay is
    // unwritable (read-only homedir, restrictive container, etc).
    opts.logger?.warn?.(
      `update_state.fallback_memory path=${path} reason=${err?.message ?? err}`
    );
    return new UpdateStateStore({ backend: "memory", logger: opts.logger });
  }
}
