// @leadbay/components — headless domain view-models for cowork artifacts.
//
// The library owns the DATA LIFECYCLE of a control: populate options from a
// Leadbay call, hold the value, expose loading/error, validate, encapsulate the
// API call + business rules. The artifact owns 100% of rendering and style.
//
// TanStack-Query's separation (headless view-models; the app renders) applied to
// business components — but VANILLA, because cowork artifacts are inline-only
// (no React, no npm; CDN allowlist is Chart/Grid/Mermaid). Copy the shape, not
// the stack. Zero runtime dependencies; inlined as one <script>.
//
// Two primitives + optional native-binding sugar:
//   lb.field({ load, options, value, validate, dependsOn })
//        → .options / .value / .setValue / .loading / .error / .valid / .subscribe
//   lb.action({ tool, args, fields, confirm, onSuccess, onError })
//        → .run() / .loading / .error / .subscribe
//   lb.bindSelect / lb.bindValue / lb.bindAction  (bind a view-model to the
//        agent's own native element — populates/syncs, injects NO style)
//
// Consumed two ways: ES import (tests) and the IIFE bundle that self-attaches
// window.LeadbayArtifacts (see build.ts).

export const VERSION = "0.3.1";

// ─── Bridge to the host (window.cowork.callMcpTool) ──────────────────────────

export type CallFn = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export class LbError extends Error {
  code?: string;
  raw?: unknown;
  constructor(message: string, opts: { code?: string; raw?: unknown } = {}) {
    super(message);
    this.name = "LbError";
    this.code = opts.code;
    this.raw = opts.raw;
  }
}

/** Normalized error state on a field/action. `null` when there is no error.
 *  `unavailable` is true when the host bridge was absent (degraded host). */
export interface LbErrorState {
  message: string;
  unavailable: boolean;
  code?: string;
}

let configuredCall: CallFn | null = null;
let timeoutMs = 30_000;

function hostCall(): CallFn | null {
  const cw = (globalThis as { cowork?: { callMcpTool?: CallFn } }).cowork;
  if (cw && typeof cw.callMcpTool === "function") {
    return (tool, args) => cw.callMcpTool!(tool, args);
  }
  return null;
}

function extractText(res: unknown): string | null {
  if (res && typeof res === "object" && "content" in res) {
    const content = (res as { content?: Array<{ text?: string }> }).content;
    if (Array.isArray(content) && content[0] && typeof content[0].text === "string") {
      return content[0].text;
    }
  }
  return null;
}

/** Collapse the MCP tool envelope in ONE place. Prefer structuredContent; fall
 *  back to parsing content[0].text; treat isError as a thrown failure. */
function normalize(res: unknown): unknown {
  if (!res || typeof res !== "object") return res;
  const obj = res as Record<string, unknown>;
  if (obj.isError) throw new LbError(extractText(res) ?? "tool call failed", { raw: res });
  if ("structuredContent" in obj && obj.structuredContent != null) return obj.structuredContent;
  const text = extractText(res);
  if (text != null) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return res;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function errState(e: unknown): LbErrorState {
  const code = e instanceof LbError ? e.code : undefined;
  return { message: messageOf(e), unavailable: code === "unavailable", code };
}

/** Override the bridge + per-call timeout (tests / non-cowork hosts). Optional —
 *  `call` resolves the host bridge lazily when not configured; `timeoutMs`
 *  defaults to 30s (pass 0 to disable). */
export function configure(opts: { call?: CallFn; timeoutMs?: number } = {}): void {
  configuredCall = opts.call ?? null;
  timeoutMs = opts.timeoutMs ?? 30_000;
}

// A bridge call that never settles would hang a view-model in `loading` forever
// (e.g. an unknown/undeployed tool the host can't route, or a wedged host). Race
// every call against a timeout so a stuck call becomes an LbError(code:"timeout")
// the UI renders as an error — never an infinite spinner.
async function withTimeout<T>(p: Promise<T>, tool: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new LbError(`"${tool}" timed out after ${timeoutMs}ms`, { code: "timeout" })),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The single path to the Leadbay API. Used for both reads (populate) and
 *  writes (submit). Normalizes the envelope; throws LbError(code:"unavailable")
 *  when no host bridge is present, or LbError(code:"timeout") if the host call
 *  doesn't settle within the configured timeout — callers degrade, never hang. */
export async function call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (configuredCall) return normalize(await withTimeout(Promise.resolve(configuredCall(tool, args)), tool));
  const host = hostCall();
  if (!host) throw new LbError("Leadbay bridge unavailable (window.cowork absent)", { code: "unavailable" });
  return normalize(await withTimeout(Promise.resolve(host(tool, args)), tool));
}

// ─── Reactive base ───────────────────────────────────────────────────────────

type Sub<T> = (self: T) => void;

class Store<T> {
  private subs = new Set<Sub<T>>();
  /** Subscribe; the callback fires immediately with current state, then on every
   *  change. Returns an unsubscribe function. */
  subscribe(cb: Sub<T>): () => void {
    this.subs.add(cb);
    cb(this as unknown as T);
    return () => this.subs.delete(cb);
  }
  protected emit(): void {
    for (const cb of this.subs) cb(this as unknown as T);
  }
}

// ─── Field — a value + (optionally API-populated) options + state ────────────

export interface Option {
  value: unknown;
  label: string;
  [k: string]: unknown;
}

export interface FieldConfig {
  /** UI intent hint (informational only — the library renders nothing). */
  kind?: string;
  /** Async loader for options, e.g. () => lb.call("leadbay_list_campaigns", {}). */
  load?: () => Promise<unknown>;
  /** Map the load result to options. Defaults to a best-effort coercion. */
  options?: (result: unknown) => Option[];
  /** Initial value. */
  value?: unknown;
  /** Return an error message for an invalid value, or null when valid. */
  validate?: (value: unknown) => string | null;
  /** Reload this field's options when any of these fields' values change
   *  (the loader typically reads their `.value`). */
  dependsOn?: Field[];
  /** Auto-load on construction when a loader is present (default true). */
  autoLoad?: boolean;
}

function coerceOptions(result: unknown): Option[] {
  if (!Array.isArray(result)) return [];
  return result.map((item) =>
    item && typeof item === "object"
      ? (item as Option)
      : { value: item, label: String(item) },
  );
}

export class Field extends Store<Field> {
  readonly kind?: string;
  value: unknown;
  options: Option[] = [];
  loading = false;
  /** `{ message, unavailable }` while in a load/validation error, else null. */
  error: LbErrorState | null = null;
  ready = false;

  private cfg: FieldConfig;
  private depUnsubs: Array<() => void> = [];
  private seq = 0;

  constructor(cfg: FieldConfig = {}) {
    super();
    this.cfg = cfg;
    this.kind = cfg.kind;
    this.value = cfg.value ?? "";

    for (const dep of cfg.dependsOn ?? []) {
      let last = dep.value;
      this.depUnsubs.push(
        dep.subscribe(() => {
          if (dep.value !== last) {
            last = dep.value;
            if (this.cfg.load) void this.load();
          }
        }),
      );
    }

    if (cfg.load && (cfg.autoLoad ?? true)) void this.load();
  }

  /** (Re)load options from the API. Overlapping loads (rapid dependsOn changes)
   *  are sequenced: only the latest call's result is applied. */
  async load(): Promise<void> {
    if (!this.cfg.load) return;
    const my = ++this.seq;
    this.loading = true;
    this.error = null;
    this.emit();
    try {
      const result = await this.cfg.load();
      if (my !== this.seq) return; // superseded by a newer load — drop stale result
      this.options = this.cfg.options ? this.cfg.options(result) : coerceOptions(result);
      this.ready = true;
      // Default the value to the first option when there's no valid current
      // value (a freshly-loaded picker). Done here in the DATA layer — via this
      // load's emit — so subscribers and dependsOn dependents see the change,
      // rather than a silent mutation inside a bind/render callback.
      const cur = this.value == null ? "" : String(this.value);
      if (this.options.length && (cur === "" || !this.options.some((o) => String(o.value) === cur))) {
        this.value = this.options[0].value;
      }
    } catch (e) {
      if (my !== this.seq) return;
      this.options = [];
      this.error = errState(e);
    } finally {
      if (my === this.seq) {
        this.loading = false;
        this.emit();
      }
    }
  }

  setValue(v: unknown): void {
    this.value = v;
    // Re-run validation on change so .error reflects the current value.
    const msg = this.validate();
    this.error = msg ? { message: msg, unavailable: false } : null;
    this.emit();
  }

  /** Current validation message (null when valid). Independent of load state. */
  validate(): string | null {
    return this.cfg.validate ? this.cfg.validate(this.value) : null;
  }

  get valid(): boolean {
    return this.validate() == null;
  }

  reset(): void {
    this.value = this.cfg.value ?? "";
    this.error = null;
    this.emit();
  }

  /** Tear down dependency subscriptions. */
  dispose(): void {
    for (const u of this.depUnsubs) u();
    this.depUnsubs = [];
  }
}

// ─── Action — a write/submit call + state ────────────────────────────────────

export interface ActionConfig {
  /** MCP tool to call, e.g. "leadbay_report_outreach". */
  tool: string;
  /** Args object, or a thunk evaluated at run time (read field values here). */
  args?: Record<string, unknown> | (() => Record<string, unknown>);
  /** Fields validated before the call; an invalid field blocks the run. */
  fields?: Field[];
  /** Confirm gesture before firing (destructive calls). */
  confirm?: string;
  onSuccess?: (result: unknown) => void;
  onError?: (error: LbErrorState) => void;
}

export class Action extends Store<Action> {
  loading = false;
  /** `{ message, unavailable }` after a failed run, else null. */
  error: LbErrorState | null = null;
  lastResult: unknown = null;

  private cfg: ActionConfig;

  constructor(cfg: ActionConfig) {
    super();
    this.cfg = cfg;
  }

  /** Validate fields, gather args, call the tool, manage loading/error. Blocks
   *  re-entry while in flight. Returns the result, or undefined if it didn't run. */
  async run(): Promise<unknown> {
    if (this.loading) return undefined;

    for (const f of this.cfg.fields ?? []) {
      const msg = f.validate();
      if (msg != null) {
        this.error = { message: msg, unavailable: false };
        this.emit();
        return undefined;
      }
    }

    if (this.cfg.confirm && typeof globalThis.confirm === "function" && !globalThis.confirm(this.cfg.confirm)) {
      return undefined;
    }

    this.loading = true;
    this.error = null;
    this.emit();
    let result: unknown;
    try {
      const args = typeof this.cfg.args === "function" ? this.cfg.args() : this.cfg.args ?? {};
      result = await call(this.cfg.tool, args);
    } catch (e) {
      this.error = errState(e);
      this.loading = false;
      this.emit();
      this.cfg.onError?.(this.error);
      return undefined;
    }
    // Success path — settle state BEFORE the user callback, and run the callback
    // OUTSIDE the try so a throw inside onSuccess isn't mis-caught as a tool error
    // (which would emit success then error for one call).
    this.lastResult = result;
    this.loading = false;
    this.emit();
    this.cfg.onSuccess?.(result);
    return result;
  }

  reset(): void {
    this.error = null;
    this.lastResult = null;
    this.emit();
  }
}

// ─── Resource — load-on-demand / poll-until-done / refresh ───────────────────
//
// One read that may CHANGE over time: lazy load on click, or poll an async job
// (enrichment) until a terminal condition. `loading` is the first-load flag;
// background poll re-reads set `refreshing` instead, so the UI doesn't flicker.
//
// NOTE on live polling: an artifact CAN setInterval+callMcpTool, but whether a
// cowork host serves FRESH reads (vs cached) is host-dependent — so `pollEvery`
// is best-effort and `refresh()` is the guaranteed manual path. Verify auto-poll
// against a real cowork host before relying on it.

export interface ResourceConfig<T = unknown> {
  load: () => Promise<T>;
  /** ms between auto-reloads until `until` is true. Omit for load-once. */
  pollEvery?: number;
  /** Terminal condition; when true, polling stops and `done` flips. */
  until?: (data: T) => boolean;
  /** Auto-load on construction (default true; pass false for load-on-click). */
  autoLoad?: boolean;
}

export class Resource extends Store<Resource> {
  data: unknown = null;
  loading = false;
  refreshing = false;
  error: LbErrorState | null = null;
  done = false;

  private cfg: ResourceConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(cfg: ResourceConfig) {
    super();
    this.cfg = cfg;
    if (cfg.autoLoad ?? true) void this.load();
  }

  async load(): Promise<void> {
    this.clearTimer();
    const my = ++this.seq; // overlapping refresh/poll: only the latest result wins
    const first = this.data == null;
    if (first) this.loading = true;
    else this.refreshing = true;
    this.error = null;
    this.emit();
    try {
      const data = await this.cfg.load();
      if (my !== this.seq) return; // superseded — drop stale response
      this.data = data;
      this.done = this.cfg.until ? this.cfg.until(data) : true;
      if (this.cfg.pollEvery && !this.done) {
        this.timer = setTimeout(() => void this.load(), this.cfg.pollEvery);
      }
    } catch (e) {
      if (my !== this.seq) return;
      this.error = errState(e);
    } finally {
      if (my === this.seq) {
        this.loading = false;
        this.refreshing = false;
        this.emit();
      }
    }
  }

  /** Manual re-fetch (always works, even when auto-poll is host-blocked). */
  refresh(): Promise<void> {
    return this.load();
  }

  /** Halt auto-polling. */
  stop(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ─── List — a paginated collection of rows ───────────────────────────────────

export interface ListConfig<T = unknown> {
  load: (args: { page: number; pageSize: number }) => Promise<{ items: T[]; total?: number }>;
  pageSize?: number;
  autoLoad?: boolean;
}

export class ListModel extends Store<ListModel> {
  items: unknown[] = [];
  page = 0;
  pageSize: number;
  total = 0;
  loading = false;
  error: LbErrorState | null = null;

  private cfg: ListConfig;
  private seq = 0;

  constructor(cfg: ListConfig) {
    super();
    this.cfg = cfg;
    this.pageSize = cfg.pageSize ?? 20;
    if (cfg.autoLoad ?? true) void this.loadPage(0);
  }

  async loadPage(page: number): Promise<void> {
    const my = ++this.seq; // rapid page flips: only the latest page's result wins
    this.loading = true;
    this.error = null;
    this.emit();
    try {
      const r = await this.cfg.load({ page, pageSize: this.pageSize });
      if (my !== this.seq) return; // superseded — drop stale page
      this.items = r.items ?? [];
      this.total = r.total ?? this.items.length;
      this.page = page;
    } catch (e) {
      if (my !== this.seq) return;
      this.error = errState(e);
    } finally {
      if (my === this.seq) {
        this.loading = false;
        this.emit();
      }
    }
  }

  next(): Promise<void> {
    return this.loadPage(this.page + 1);
  }
  prev(): Promise<void> {
    return this.loadPage(Math.max(0, this.page - 1));
  }
  get hasMore(): boolean {
    return (this.page + 1) * this.pageSize < this.total;
  }
}

// ─── Optional native-binding sugar (no style; injects no visuals) ────────────
//
// Bind a view-model to the agent's OWN element. We only set the native value /
// options / disabled and a `data-lb-state` / `data-lb-error` styling HOOK — the
// agent styles those however it likes. Each returns an unbind function.

function reflectState(el: Element, vm: { loading: boolean; error: LbErrorState | null }): void {
  const state = vm.error?.unavailable ? "unavailable" : vm.loading ? "loading" : vm.error ? "error" : "ready";
  el.setAttribute("data-lb-state", state);
  if (vm.error) el.setAttribute("data-lb-error", vm.error.message);
  else el.removeAttribute("data-lb-error");
}

/** Populate a <select>'s <option>s from a field's loaded options + two-way bind
 *  the value. Use for API-populated pickers. */
export function bindSelect(el: HTMLSelectElement, field: Field): () => void {
  const onChange = () => field.setValue(el.value);
  el.addEventListener("change", onChange);
  const unsub = field.subscribe(() => {
    reflectState(el, field);
    el.disabled = field.loading;
    el.innerHTML = "";
    for (const opt of field.options) {
      const o = document.createElement("option");
      o.value = String(opt.value);
      o.textContent = opt.label;
      el.appendChild(o);
    }
    // Field.load already defaults the value to the first option on load, so the
    // render layer just reflects it — no silent value mutation here.
    el.value = field.value == null ? "" : String(field.value);
  });
  return () => {
    el.removeEventListener("change", onChange);
    unsub();
  };
}

/** Two-way bind a control's value to a field (no option population). Use for
 *  text inputs, textareas, checkboxes, and static-enum <select>s. */
export function bindValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  field: Field,
): () => void {
  const isCheckbox = (el as HTMLInputElement).type === "checkbox";
  const evt = el.tagName === "SELECT" ? "change" : "input";
  const onInput = () => field.setValue(isCheckbox ? (el as HTMLInputElement).checked : el.value);
  el.addEventListener(evt, onInput);
  const unsub = field.subscribe(() => {
    if (isCheckbox) {
      (el as HTMLInputElement).checked = Boolean(field.value);
    } else {
      const v = field.value == null ? "" : String(field.value);
      if (el.value !== v) el.value = v;
    }
    el.setAttribute("data-lb-state", field.error ? "error" : "ready");
    if (field.error) el.setAttribute("data-lb-error", field.error.message);
    else el.removeAttribute("data-lb-error");
  });
  return () => {
    el.removeEventListener(evt, onInput);
    unsub();
  };
}

/** Wire a clickable element to an action: click → run, with state reflected as
 *  data-lb-state (idle|loading|error|success|unavailable) + disabled while in flight. */
export function bindAction(el: HTMLElement, action: Action): () => void {
  const onClick = (e: Event) => {
    e.preventDefault();
    void action.run();
  };
  el.addEventListener("click", onClick);
  const unsub = action.subscribe(() => {
    const state = action.error?.unavailable
      ? "unavailable"
      : action.loading
        ? "loading"
        : action.error
          ? "error"
          : action.lastResult != null
            ? "success"
            : "idle";
    el.setAttribute("data-lb-state", state);
    if ("disabled" in el) (el as unknown as { disabled: boolean }).disabled = action.loading;
    if (action.error) el.setAttribute("data-lb-error", action.error.message);
    else el.removeAttribute("data-lb-error");
  });
  return () => {
    el.removeEventListener("click", onClick);
    unsub();
  };
}

// ─── Domain components (pre-wired view-models for common Leadbay shapes) ─────
//
// Each bakes in the tool name + arg shape + the footguns (report_outreach's
// verification + _triggered_by; the enrichment launch→poll lifecycle), so the
// artifact writes almost no Leadbay-specific logic — just renders the state.

export const EPILOGUE_STATUSES = [
  "STILL_CHASING",
  "COULD_NOT_REACH_STILL_TRYING",
  "INTEREST_VALIDATED_OR_MEETING_PLANED",
  "NOT_INTERESTED_LOST",
] as const;

/** Campaign picker field — options populated from leadbay_list_campaigns. */
function campaigns(ask: string): Field {
  return new Field({
    kind: "select",
    load: () => call("leadbay_list_campaigns", { _triggered_by: ask }),
    options: (r) => {
      const list = (r as { campaigns?: Array<Record<string, any>> })?.campaigns ?? [];
      return list
        .map((e) => {
          const c = (e?.campaign ?? e) as Record<string, any>;
          return c?.id ? { value: c.id, label: c.name ?? c.ai_generated_name ?? String(c.id) } : null;
        })
        .filter((o): o is Option => o != null);
    },
  });
}

interface OutreachOpts {
  leadId: string;
  ask: string;
  /** Field holding the epilogue_status value (a static-enum select). */
  status?: Field;
  /** Field holding the call note (gated: required to submit). */
  note?: Field;
  ref?: string;
}
/** report_outreach action with verification + _triggered_by baked in (the two
 *  things an artifact gets rejected for forgetting). */
function outreach(opts: OutreachOpts): Action {
  return new Action({
    tool: "leadbay_report_outreach",
    fields: opts.note ? [opts.note] : [],
    args: () => ({
      lead_id: opts.leadId,
      ...(opts.status ? { epilogue_status: opts.status.value } : {}),
      note: opts.note ? opts.note.value : "",
      verification: { source: "user_confirmed", ref: opts.ref ?? "logged from artifact" },
      _triggered_by: opts.ask,
    }),
  });
}

/** add_note action (no verification / _triggered_by needed). */
function noteAction(opts: { leadId: string; note: Field }): Action {
  return new Action({
    tool: "leadbay_add_note",
    fields: [opts.note],
    args: () => ({ leadId: opts.leadId, note: opts.note.value }),
  });
}

function like(leadId: string): Action {
  return new Action({ tool: "leadbay_like_lead", args: { lead_id: leadId } });
}
function dislike(leadId: string): Action {
  return new Action({ tool: "leadbay_dislike_lead", args: { lead_id: leadId } });
}

/** Lazy lead history (notes + activities + engagement) via account_history. */
function leadHistory(leadId: string, ask: string): Resource {
  return new Resource({
    autoLoad: false,
    load: () => call("leadbay_account_history", { leadId, _triggered_by: ask }),
  });
}

/** Lazy full lead profile via research_lead_by_id (click-to-open). */
function leadProfile(leadId: string, ask: string): Resource {
  return new Resource({
    autoLoad: false,
    load: () => call("leadbay_research_lead_by_id", { leadId, _triggered_by: ask }),
  });
}

interface EnrichOpts {
  leadIds?: string[];
  titles: string[];
  ask: string;
  email?: boolean;
  phone?: boolean;
  /** Poll interval in ms (default 4000). */
  pollEvery?: number;
}
/** Enrichment job: launches via enrich_titles, then polls bulk_enrich_status
 *  until all_done. `.data` carries overall_progress + per-lead contacts; `.done`
 *  flips when complete; `.refresh()` forces a status read (the guaranteed path
 *  if the host caches auto-poll reads). */
function enrichment(opts: EnrichOpts): Resource {
  let bulkId: string | null = null;
  return new Resource({
    pollEvery: opts.pollEvery ?? 4000,
    until: (d) => Boolean((d as { all_done?: boolean })?.all_done),
    load: async () => {
      if (!bulkId) {
        const r = (await call("leadbay_enrich_titles", {
          ...(opts.leadIds ? { leadIds: opts.leadIds } : {}),
          titles: opts.titles,
          email: opts.email ?? true,
          phone: opts.phone ?? false,
          // An enrichment widget the user is interacting with IS the consent —
          // send confirm so the composite's #3848 gate launches directly rather
          // than eliciting again for a spend the user already initiated.
          confirm: true,
          _triggered_by: opts.ask,
        })) as { bulk_id?: string; mode?: string; preview?: unknown };
        bulkId = r?.bulk_id ?? null;
        if (!bulkId) {
          // No job launched (nothing enrichable / preview-only) — terminal, not an error.
          return { all_done: true, no_job: true, mode: r?.mode, preview: r?.preview };
        }
      }
      return call("leadbay_bulk_enrich_status", { bulk_id: bulkId, _triggered_by: opts.ask });
    },
  });
}

interface CallListOpts {
  source?: "followups" | "campaign";
  campaignId?: string;
  city?: string;
  ask: string;
  pageSize?: number;
}
/** A paginated lead list for cold-calling — Monitor follow-ups or a campaign. */
function callList(opts: CallListOpts): ListModel {
  const source = opts.source ?? "followups";
  return new ListModel({
    pageSize: opts.pageSize ?? 20,
    load: async ({ page, pageSize }) => {
      const r =
        source === "campaign"
          ? await call("leadbay_campaign_call_sheet", {
              campaign_id: opts.campaignId,
              page,
              count: pageSize,
              _triggered_by: opts.ask,
            })
          : await call("leadbay_pull_followups", {
              page,
              count: pageSize,
              ...(opts.city ? { city: opts.city } : {}),
              _triggered_by: opts.ask,
            });
      const o = r as {
        leads?: unknown[];
        items?: unknown[];
        total_leads?: number;
        pagination?: { total?: number };
      };
      const items = o.leads ?? o.items ?? [];
      return { items, total: o.total_leads ?? o.pagination?.total ?? items.length };
    },
  });
}

/** Manager team-activity (per-rep leaderboard + activity trend) for a window. */
function teamActivity(opts: { weeks?: number; ask: string }): Resource {
  return new Resource({
    load: () => call("leadbay_team_activity", { weeks: opts.weeks ?? 4, _triggered_by: opts.ask }),
  });
}

// ─── Public surface ──────────────────────────────────────────────────────────

export const lb = {
  VERSION,
  configure,
  call,
  // primitives
  field: (cfg?: FieldConfig) => new Field(cfg),
  action: (cfg: ActionConfig) => new Action(cfg),
  resource: (cfg: ResourceConfig) => new Resource(cfg),
  list: (cfg: ListConfig) => new ListModel(cfg),
  // native-binding sugar
  bindSelect,
  bindValue,
  bindAction,
  // domain components
  campaigns,
  outreach,
  note: noteAction,
  like,
  dislike,
  leadHistory,
  leadProfile,
  enrichment,
  callList,
  teamActivity,
  EPILOGUE_STATUSES,
};

// Self-attach the global for inline-script artifacts (from inside the module
// body — some script VMs don't expose esbuild's top-level `var`).
declare global {
  interface Window {
    LeadbayArtifacts?: typeof lb;
  }
}
if (typeof globalThis !== "undefined") {
  (globalThis as unknown as { LeadbayArtifacts?: typeof lb }).LeadbayArtifacts = lb;
}
