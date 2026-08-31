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

import { STYLES, STYLE_ELEMENT_ID } from "./styles.js";

export const VERSION = "0.5.0";

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

/** Inject the optional `lb-*` stylesheet (see styles.ts). OPT-IN: the library
 *  still renders no markup, and an artifact that never calls this gets exactly
 *  the unstyled HTML it wrote. Idempotent — calling it twice injects once, so
 *  per-row wiring can call it freely. Returns the <style> element, or null when
 *  there is no document (a non-DOM host); never throws. */
export function styles(): HTMLStyleElement | null {
  if (typeof document === "undefined" || !document.head) return null;
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (existing) return existing as HTMLStyleElement;
  const el = document.createElement("style");
  el.id = STYLE_ELEMENT_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
  return el;
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
  /** Inspect a RESOLVED tool result and return a message to treat it as a
   *  failure, or null to accept. Leadbay tools answer HTTP-200 with an
   *  `{error:true,code,message}` envelope for input/quota problems, and some
   *  report partial writes (`failed:[…]`) — without this the button would flip
   *  to data-lb-state="success" on both. Runs IN ADDITION to the built-in
   *  `{error:true}` check, which needs no configuration. */
  checkResult?: (result: unknown) => string | null;
  onSuccess?: (result: unknown) => void;
  onError?: (error: LbErrorState) => void;
}

/** Leadbay's HTTP-200 failure envelope: { error: true, code?, message?, hint? }.
 *  Returns a human message when the result is one, else null. */
function envelopeError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const o = result as Record<string, unknown>;
  if (o.error !== true) return null;
  const msg = typeof o.message === "string" && o.message ? o.message : "tool call failed";
  const hint = typeof o.hint === "string" && o.hint ? ` — ${o.hint}` : "";
  return `${msg}${hint}`;
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
    // A resolved call is not necessarily a successful one: Leadbay answers
    // HTTP 200 with { error: true, code, message } for BAD_INPUT / quota /
    // permission problems. Treat that envelope as a failure so bindAction
    // reflects data-lb-state="error", not "success".
    const problem = envelopeError(result) ?? this.cfg.checkResult?.(result) ?? null;
    if (problem != null) {
      this.error = { message: problem, unavailable: false };
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

// ─── Sort order ──────────────────────────────────────────────────────────────
//
// Mirrors the web app's TableSort: one <select> whose values are the backend's
// `FIELD:ASC|DESC` LeadOrder strings, with an arrow marking the direction. The
// app renders two entries per column (asc + desc); we do the same, but as a flat
// list because an artifact has no column header to hang a toggle off.

/** Sort options for a follow-up list, in the order a rep is most likely to
 *  want them. Values are the backend LeadOrder enum — leadbay_pull_followups
 *  rejects anything outside it, because the endpoint answers 200-with-no-rows
 *  on an unknown order rather than erroring. */
export const SORT_ORDERS: ReadonlyArray<Option> = [
  { value: "", label: "Default ranking" },
  { value: "SCORE:DESC", label: "Score ↓" },
  { value: "SCORE:ASC", label: "Score ↑" },
  { value: "NAME:ASC", label: "Name A→Z" },
  { value: "NAME:DESC", label: "Name Z→A" },
  { value: "SIZE:DESC", label: "Size ↓" },
  { value: "SIZE:ASC", label: "Size ↑" },
  { value: "SECTOR:ASC", label: "Sector A→Z" },
  { value: "STATUS:ASC", label: "Status A→Z" },
  { value: "CONTACT_COUNT:DESC", label: "Contacts ↓" },
  { value: "LAST_PROSPECTING_ACTION_AT:DESC", label: "Last action ↓" },
  { value: "LAST_PROSPECTING_ACTION_AT:ASC", label: "Last action ↑" },
  { value: "EPILOGUE_STATUS_SET_AT:DESC", label: "Outcome set ↓" },
  { value: "LIKED:DESC", label: "Liked first" },
  { value: "DISLIKED:DESC", label: "Disliked first" },
];

/** Sort picker field. Static options, no API call — bind with lb.bindSelect.
 *  The empty value means "no order param", i.e. the Monitor's own ranking,
 *  which is what a rep working a list top-down expects by default. */
function sortOrder(current?: string | null): Field {
  const cur = String(current ?? "").trim().toUpperCase();
  const known = SORT_ORDERS.some((o) => o.value === cur);
  return new Field({
    kind: "select",
    value: known ? cur : "",
    load: async () => SORT_ORDERS.slice(),
  });
}

// ─── Lead status (org-wide CRM status) ───────────────────────────────────────
//
// NOT the epilogue statuses above. Two separate systems:
//   lead status     — WANTED/WON/LOST/UNWANTED, org-wide, a commercial outcome
//   epilogue status — the disposition of one outreach attempt, drives followups
// Setting one never sets the other. See leadbay_set_lead_status's description.

/** The statuses a human picks, in dropdown order. DEFAULT and INBOUND are set
 *  by Leadbay itself and are deliberately absent. */
export const LEAD_STATUSES: ReadonlyArray<Option> = [
  { value: "WANTED", label: "Wanted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "UNWANTED", label: "Unwanted" },
];

const UNSET_OPTION: Option = { value: "", label: "— Not set —" };

/** Lead-status picker field. Static options (no API call), so bind it with
 *  `lb.bindSelect` — the options land on the first emit.
 *
 *  Seed `current` with the lead's existing status (`org_lead_status` on a
 *  seed-candidates row) so the select opens on the true value. When the lead has
 *  no settable status yet, a leading "— Not set —" option is prepended and
 *  selected: the dropdown must not imply "Wanted" for a lead nobody has touched.
 *  That placeholder fails validation, so a save can't fire until a real choice
 *  is made. */
function leadStatus(current?: string | null): Field {
  const cur = String(current ?? "").trim().toUpperCase();
  const known = LEAD_STATUSES.some((o) => o.value === cur);
  return new Field({
    kind: "select",
    value: known ? cur : "",
    validate: (v) => (String(v ?? "") === "" ? "Pick a status" : null),
    // Resolves immediately — this is the emit/ready bookkeeping path, not I/O.
    load: async () => (known ? LEAD_STATUSES.slice() : [UNSET_OPTION, ...LEAD_STATUSES]),
  });
}

export interface SetStatusOpts {
  /** One lead, or use `leadIds` for a bulk apply across selected rows.
   *  `leadIds` may be a thunk, evaluated at run() time — pass one when the
   *  selection is live (checkboxes the user is still ticking). */
  leadId?: string;
  leadIds?: string[] | (() => string[]);
  /** The field holding the chosen status (from `lb.leadStatus()`). */
  status: Field;
  /** Optional field holding a YYYY-MM-DD close date → `set_status_date`. */
  date?: Field;
  /** The user request this artifact serves — recorded as `_triggered_by`. */
  ask?: string;
  confirm?: string;
}

/** set_lead_status action. Bakes in the arg shape and the partial-write check:
 *  the tool writes each lead individually, so some can fail while the call as a
 *  whole resolves 200. `checkResult` turns any `failed[]` entry into an error
 *  state rather than a green button that wrote nothing. */
function setStatus(opts: SetStatusOpts): Action {
  const ids = (): string[] => {
    const v = typeof opts.leadIds === "function" ? opts.leadIds() : opts.leadIds;
    if (Array.isArray(v)) return v;
    return opts.leadId ? [opts.leadId] : [];
  };
  return new Action({
    tool: "leadbay_set_lead_status",
    fields: opts.date ? [opts.status, opts.date] : [opts.status],
    confirm: opts.confirm,
    args: () => ({
      lead_ids: ids(),
      status: opts.status.value,
      ...(opts.date && opts.date.value ? { status_date: opts.date.value } : {}),
      ...(opts.ask ? { _triggered_by: opts.ask } : {}),
    }),
    checkResult: (r) => {
      const failed = (r as { failed?: Array<{ lead_id?: string; message?: string }> })?.failed;
      if (!Array.isArray(failed) || failed.length === 0) return null;
      const total = ids().length;
      const first = failed[0]?.message ?? "write rejected";
      return failed.length === total
        ? `Status not applied: ${first}`
        : `${failed.length} of ${total} leads failed: ${first}`;
    },
  });
}

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
  /** Explicit spend consent for the paid reveal. Set true ONLY from a real user
   *  action (a click handler), NEVER by default — otherwise merely rendering the
   *  widget would authorize the spend (product#3848 / Codex P1). Omitted → the
   *  server's consent gate (elicitation / needs_confirmation) decides at launch,
   *  so an auto-loaded widget can never silently spend. */
  confirm?: boolean;
  /** Auto-load on construction (default true, matching Resource). Safe now that
   *  `confirm` is NOT auto-sent: an auto-load without an explicit `confirm`
   *  hits the server consent gate, which elicits or returns needs_confirmation
   *  rather than spending. For a paid launch, prefer autoLoad:false + a click. */
  autoLoad?: boolean;
}
/** Enrichment job: launches via enrich_titles, then polls bulk_enrich_status
 *  until all_done. `.data` carries overall_progress + per-lead contacts; `.done`
 *  flips when complete; `.refresh()` forces a status read (the guaranteed path
 *  if the host caches auto-poll reads).
 *
 *  IMPORTANT (product#3848 / Codex P1): this is a PAID launch, and it does NOT
 *  self-confirm — `confirm` is forwarded ONLY if the caller passes it (from a
 *  real user action). Without it, the server's consent gate decides (host
 *  elicitation, or mode:needs_confirmation with no spend), so even an
 *  auto-loaded widget cannot silently spend on a page render. */
function enrichment(opts: EnrichOpts): Resource {
  let bulkId: string | null = null;
  return new Resource({
    ...(opts.autoLoad !== undefined ? { autoLoad: opts.autoLoad } : {}),
    pollEvery: opts.pollEvery ?? 4000,
    until: (d) => Boolean((d as { all_done?: boolean })?.all_done),
    load: async () => {
      if (!bulkId) {
        const r = (await call("leadbay_enrich_titles", {
          ...(opts.leadIds ? { leadIds: opts.leadIds } : {}),
          titles: opts.titles,
          ...(opts.email !== undefined ? { email: opts.email } : {}),
          ...(opts.phone !== undefined ? { phone: opts.phone } : {}),
          // Forward consent ONLY if the caller supplied it (from a real user
          // action). Never a blanket true — page load is not consent.
          ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
          _triggered_by: opts.ask,
        })) as { bulk_id?: string } & Record<string, unknown>;
        bulkId = (r?.bulk_id as string | undefined) ?? null;
        if (!bulkId) {
          // No job launched (nothing enrichable / preview-only / awaiting
          // confirmation) — terminal for this resource, not an error. Preserve
          // the FULL response (credits_remaining, would_launch, message,
          // next_action, mode, preview) so an artifact can render the spend
          // preview + re-call instructions on mode:"needs_confirmation" and
          // drive explicit consent (Codex P2) — don't reduce it to {mode,preview}.
          return { ...r, all_done: true, no_job: true };
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
  /** A Field holding a LeadOrder string (from `lb.sortOrder()`), or a literal.
   *  Read at load time, so changing it and calling `.loadPage(0)` re-sorts. */
  order?: Field | string;
}
export interface LeadListOpts {
  lensId?: number;
  ask: string;
  pageSize?: number;
  /** A Field holding a LeadOrder string (from `lb.sortOrder()`), or a literal.
   *  Read at request time, so changing it and calling `.loadPage(0)` re-sorts. */
  order?: Field | string;
}
/** A paginated DISCOVER list (leadbay_pull_leads), sortable via `order`.
 *  Use this rather than re-sorting rows client-side: the backend sorts the WHOLE
 *  lens and returns the requested page of that, so sorting one page in the
 *  browser would silently show the wrong leads. The pull_leads RENDERING block
 *  says never to re-order the rows it returns — `order` is the sanctioned way. */
function leadList(opts: LeadListOpts): ListModel {
  const orderValue = (): string =>
    typeof opts.order === "string" ? opts.order : String(opts.order?.value ?? "");
  return new ListModel({
    pageSize: opts.pageSize ?? 20,
    load: async ({ page, pageSize }) => {
      const r = (await call("leadbay_pull_leads", {
        page,
        count: pageSize,
        ...(opts.lensId ? { lensId: opts.lensId } : {}),
        ...(orderValue() ? { order: orderValue() } : {}),
        _triggered_by: opts.ask,
      })) as { leads?: unknown[]; pagination?: { total?: number } };
      const items = r.leads ?? [];
      return { items, total: r.pagination?.total ?? items.length };
    },
  });
}
/** A paginated lead list for cold-calling — Monitor follow-ups or a campaign. */
function callList(opts: CallListOpts): ListModel {
  const source = opts.source ?? "followups";
  // Read at request time, not at build time, so a bound select re-sorts the
  // list on the next loadPage without rebuilding the view-model.
  const orderValue = (): string =>
    typeof opts.order === "string" ? opts.order : String(opts.order?.value ?? "");
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
              ...(orderValue() ? { order: orderValue() } : {}),
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
  styles,
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
  leadStatus,
  setStatus,
  sortOrder,
  leadHistory,
  leadProfile,
  enrichment,
  callList,
  leadList,
  teamActivity,
  EPILOGUE_STATUSES,
  LEAD_STATUSES,
  SORT_ORDERS,
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
