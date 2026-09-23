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

export const VERSION = "0.6.1";

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

// ─── Runtime telemetry (product#4081) ────────────────────────────────────────
//
// The artifact runs in a chat-hosted page: its ONLY channel out is
// window.cowork.callMcpTool, so every failure signal travels as an MCP tool
// call to `leadbay_artifact_event`. The server routes it the way the rest of
// the repo already splits telemetry — exceptions to Sentry, outcomes to
// PostHog — and it inherits the `leadbay_set_telemetry` opt-out through the
// normal dispatch suppression. It is NEVER leadbay_report_friction: that tool
// is consent-gated and must not fire unprompted.
//
// Three hard rules, because a telemetry path that misbehaves is worse than none:
//   1. NEVER routed through `call()` — no normalize, no withTimeout. A telemetry
//      call that timed out would emit a timeout event, which would time out…
//   2. Fire-and-forget. A rejected emit is swallowed; telemetry never surfaces
//      in a view-model's `error` and never blocks a user action.
//   3. Bounded. Deduped on identity and hard-capped per page, so a poll loop
//      failing every 3s can't emit thousands of events.

/** What went wrong. Split by NATURE, not by call site: `kind` decides which
 *  sink the server routes to. The four exception kinds carry a thrown error;
 *  the three outcome kinds are UX facts with nothing thrown. */
export type LbEventKind =
  // → Sentry (exceptions)
  | "bridge_unavailable" // no window.cowork — a degraded host
  | "call_timeout" // the host never settled within timeoutMs
  | "call_failed" // the host rejected, or answered isError
  | "parse_failed" // content[0].text was neither JSON nor absent
  // → PostHog (outcomes — nothing threw)
  | "options_empty" // a picker loaded successfully with zero options
  | "action_blocked" // field validation stopped a run before any call
  | "result_rejected"; // a RESOLVED call carried an error envelope / failed checkResult

/** Which view-model surfaced it — lets a dashboard tell a dead dropdown from a
 *  dead poll without a separate event name per class. */
export type LbEventSurface = "call" | "field" | "action" | "resource" | "list";

export interface LbEvent {
  kind: LbEventKind;
  surface: LbEventSurface;
  /** The Leadbay tool involved, when the failure is attributable to one. */
  tool?: string;
  /** Bounded error code (LbError.code / envelope code) — NEVER a message.
   *  Messages can carry API payload text the user never approved for sending
   *  (the product#3943 line), so only codes travel. */
  code?: string;
}

const TELEMETRY_TOOL = "leadbay_artifact_event";
// A page that has failed 40 distinct ways is already telling us everything it
// can; past that we are only adding noise and host round-trips.
const MAX_EVENTS = 40;
const seenEvents = new Set<string>();
let emitted = 0;
let telemetryOn = true;

/** Disable runtime telemetry for this page (tests, and any artifact that wants
 *  out). The account-level `leadbay_set_telemetry` opt-out is enforced
 *  server-side regardless of this flag. */
export function setTelemetry(enabled: boolean): void {
  telemetryOn = enabled;
}

/** Test seam — reset the dedupe/cap state between cases. */
export function resetTelemetry(): void {
  seenEvents.clear();
  emitted = 0;
  telemetryOn = true;
  activeSlot = null;
  runningSurface = "call";
}

/** Report a runtime failure to the MCP. Fire-and-forget: returns nothing,
 *  throws nothing, and is a no-op when there is no host bridge (a local test
 *  or a degraded host — where `bridge_unavailable` itself has no way home). */
export function report(ev: LbEvent): void {
  if (!telemetryOn || emitted >= MAX_EVENTS) return;
  const key = `${ev.kind}|${ev.surface}|${ev.tool ?? ""}|${ev.code ?? ""}`;
  if (seenEvents.has(key)) return;
  seenEvents.add(key);
  emitted++;
  // Deliberately the RAW host bridge, not `call()` — see rule 1 above. When the
  // bridge is absent there is nowhere to report to, which is exactly the
  // `bridge_unavailable` case; it stays a local-only signal on that host.
  const host = hostCall();
  if (!host) return;
  try {
    const p = host(TELEMETRY_TOOL, {
      kind: ev.kind,
      surface: ev.surface,
      kit_version: VERSION,
      ...(ev.tool ? { tool: ev.tool } : {}),
      ...(ev.code ? { code: ev.code } : {}),
    });
    // Swallow rejection AND avoid an unhandled-rejection warning in the page.
    if (p && typeof (p as Promise<unknown>).catch === "function") {
      void (p as Promise<unknown>).catch(() => {});
    }
  } catch {
    /* telemetry must never surface to the user */
  }
}

// Which view-model's loader is currently on the stack. Set by `withSurface`
// around each load/run so the chokepoint in `call()` can attribute a transport
// failure to the control that died, without every view-model re-reporting the
// same error. JS is single-threaded and the marker is read SYNCHRONOUSLY by
// `call()` before its first await, so concurrent in-flight loads can't
// cross-attribute: whoever called `call()` last is whoever is running now.
let runningSurface: LbEventSurface = "call";

// Where a load records the tool it called, so an OUTCOME event fired after the
// load resolves can name it. A view-model's loader is an opaque thunk
// (`() => lb.call("leadbay_list_campaigns", {})`) — the tool name is on neither
// the config nor (for an outcome) an error, so `call()` is the only place it
// exists.
//
// This is a PER-LOAD slot, deliberately not a shared `lastTool` global. A
// global would be written by whichever call started most recently and read
// after an await, so two pickers mounting together — an ordinary artifact
// layout — would cross-attribute: picker A resolving empty would report
// picker B's tool. That is the same race `runningSurface` avoids by
// snapshotting at `call()` entry, and it has to be avoided here too.
//
// Only the first `call()` a loader makes synchronously is captured: after the
// loader's first await, `withSurface` has already restored `activeSlot`. A
// multi-call loader therefore reports its first tool or none — never another
// control's. `tool` is optional on LbEvent precisely because it can be absent.
interface LoadSlot {
  tool?: string;
}
let activeSlot: LoadSlot | null = null;

// NOTE on the reset: `fn()` returns its promise SYNCHRONOUSLY, so this restores
// the marker as soon as the loader has been kicked off — not when it settles.
// That is deliberate and it is why `call()` snapshots `runningSurface` at entry,
// before its first await, rather than reading it in its catch. A loader that
// reaches `call()` through an await (`async () => { await x; return call(…) }`)
// would otherwise see the marker already restored. Snapshotting at entry also
// keeps concurrent loads from cross-attributing.
function withSurface<T>(
  surface: LbEventSurface,
  fn: () => Promise<T>,
  slot?: LoadSlot,
): Promise<T> {
  const prevSurface = runningSurface;
  const prevSlot = activeSlot;
  runningSurface = surface;
  activeSlot = slot ?? null;
  try {
    return fn();
  } finally {
    runningSurface = prevSurface;
    activeSlot = prevSlot;
  }
}

/** Report a caught error, mapping its code to the right kind. Used by every
 *  view-model catch block so the classification lives in ONE place. */
function reportError(surface: LbEventSurface, tool: string | undefined, e: unknown): void {
  const code = codeOf(e);
  const kind: LbEventKind =
    code === "timeout" ? "call_timeout" : code === "unavailable" ? "bridge_unavailable" : "call_failed";
  report({ kind, surface, tool, code });
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
function normalize(res: unknown, tool?: string, surface: LbEventSurface = "call"): unknown {
  if (!res || typeof res !== "object") return res;
  const obj = res as Record<string, unknown>;
  if (obj.isError) throw new LbError(extractText(res) ?? "tool call failed", { raw: res });
  if ("structuredContent" in obj && obj.structuredContent != null) return obj.structuredContent;
  const text = extractText(res);
  if (text != null) {
    try {
      return JSON.parse(text);
    } catch {
      // The silent one (product#4081). Returning the raw string is the right
      // FALLBACK — a tool may legitimately answer prose — but when the caller
      // expected an object this is where the artifact quietly starts rendering
      // nothing, with no error anywhere. Report it; keep the lenient behavior.
      report({ kind: "parse_failed", surface, tool });
      return text;
    }
  }
  return res;
}

// A rejection is not always an Error. The `mcp` capability's `callTool`
// rejects with a PLAIN OBJECT ({code, message, server, retryable}), so
// `String(e)` on it yields the literal "[object Object]" and the code — the
// one field that says whether to reconnect, add the connector or just wait —
// is lost before it reaches the UI. Read both off any object that carries
// them, whatever its prototype.
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(e);
    } catch {
      /* circular — fall through to String() */
    }
  }
  return String(e);
}
function codeOf(e: unknown): string | undefined {
  if (e instanceof LbError) return e.code;
  if (e && typeof e === "object") {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return undefined;
}
function errState(e: unknown): LbErrorState {
  const code = codeOf(e);
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
  // Never report on the telemetry tool itself — a failing reporter that reports
  // its own failure is the one loop this design must not have.
  const silent = tool === TELEMETRY_TOOL;
  // Snapshot the surface, and record the tool into the running load's slot,
  // SYNCHRONOUSLY — before the first await, while this call's loader is still
  // on the stack. See the notes on withSurface and LoadSlot. Reading either
  // after an await would attribute to whichever load started most recently.
  const surface = runningSurface;
  if (!silent && activeSlot && activeSlot.tool === undefined) {
    activeSlot.tool = tool;
  }
  const fn = configuredCall ?? hostCall();
  if (!fn) {
    if (!silent) report({ kind: "bridge_unavailable", surface, tool, code: "unavailable" });
    throw new LbError("Leadbay bridge unavailable (window.cowork absent)", { code: "unavailable" });
  }
  try {
    return normalize(
      await withTimeout(Promise.resolve(fn(tool, args)), tool),
      silent ? undefined : tool,
      surface,
    );
  } catch (e) {
    // ONE chokepoint for every transport failure: host rejection, isError
    // envelope, and the withTimeout race — so nothing escapes unreported even
    // for a bare `lb.call(...)` an artifact makes directly.
    //
    // The view-models do NOT re-report their catches: `surface` is set from
    // the loader that is currently running (see `runningSurface`), because the
    // useful question is "which control died", and a view-model catch can only
    // ever see an error this line already saw. One event, right surface.
    if (!silent) reportError(surface, tool, e);
    throw e;
  }
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
      const slot: LoadSlot = {};
      const result = await withSurface("field", () => this.cfg.load!(), slot);
      if (my !== this.seq) return; // superseded by a newer load — drop stale result
      this.options = this.cfg.options ? this.cfg.options(result) : coerceOptions(result);
      this.ready = true;
      // The unpopulated dropdown (product#4081). NOT an exception — the call
      // succeeded, so nothing throws and `error` stays null; the user just sees
      // an empty picker and no way to proceed. Reported as an OUTCOME.
      //
      // The tool comes from THIS load's slot, not a shared global and not
      // cfg.kind (a UI hint, "select", never a tool name). Two pickers mounting
      // together would cross-attribute through a global — see LoadSlot.
      if (this.options.length === 0) {
        report({ kind: "options_empty", surface: "field", tool: slot.tool });
      }
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
        // The blocked button (product#4081). No call is made, so no tool-call
        // event would ever exist — the user clicks and nothing happens, and
        // today that is invisible. An OUTCOME, not an exception; the validation
        // MESSAGE is author-written UI copy but can interpolate user input, so
        // only the fact is reported, never the text.
        report({ kind: "action_blocked", surface: "action", tool: this.cfg.tool });
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
      result = await withSurface("action", () => call(this.cfg.tool, args));
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
      // The call that REPORTED success (HTTP 200, promise resolved) but wasn't
      // one — a `{error:true}` envelope or a partial write caught by
      // checkResult (product#4081). An outcome, not an exception: nothing
      // threw, so Sentry would never see it. Envelope `code` is a bounded
      // enum and safe to send; `message` is not, and is deliberately omitted.
      const envCode =
        result && typeof result === "object"
          ? (result as { code?: unknown }).code
          : undefined;
      report({
        kind: "result_rejected",
        surface: "action",
        tool: this.cfg.tool,
        ...(typeof envCode === "string" && envCode ? { code: envCode } : {}),
      });
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
      const data = await withSurface("resource", () => this.cfg.load());
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
      const r = await withSurface("list", () => this.cfg.load({ page, pageSize: this.pageSize }));
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
  // A success state must DWELL, not persist. `lastResult` is never cleared on
  // its own, so without this the control stays green for the life of the
  // artifact — still claiming "saved" after the rep has changed the value to
  // something that was never written.
  let settle: ReturnType<typeof setTimeout> | undefined;
  const unsub = action.subscribe(() => {
    const state = action.error?.unavailable
      ? "unavailable"
      : action.loading
        ? "loading"
        : action.error
          ? "error"
          : action.lastResult != null
            ? "success"
            : "ready";
    el.setAttribute("data-lb-state", state);
    if ("disabled" in el) (el as unknown as { disabled: boolean }).disabled = action.loading;
    // aria-busy is the assistive-tech equivalent of the loading style; without
    // it an in-flight write is silent to a screen reader.
    el.setAttribute("aria-busy", String(action.loading));
    if (action.error) el.setAttribute("data-lb-error", action.error.message);
    else el.removeAttribute("data-lb-error");
    if (settle) clearTimeout(settle);
    if (state === "success") {
      settle = setTimeout(() => {
        if (!action.loading && !action.error) el.setAttribute("data-lb-state", "ready");
      }, 1600);
    }
  });
  return () => {
    el.removeEventListener("click", onClick);
    unsub();
    if (settle) clearTimeout(settle);
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

const UNSET_OPTION: Option = { value: "", label: "Pick a status" };

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
  let job: { notification_id: string | null; lead_ids: string[] } | null = null;
  return new Resource({
    ...(opts.autoLoad !== undefined ? { autoLoad: opts.autoLoad } : {}),
    pollEvery: opts.pollEvery ?? 4000,
    until: (d) => Boolean((d as { all_done?: boolean })?.all_done),
    load: async () => {
      if (!job) {
        const r = (await call("leadbay_enrich_titles", {
          ...(opts.leadIds ? { leadIds: opts.leadIds } : {}),
          titles: opts.titles,
          ...(opts.email !== undefined ? { email: opts.email } : {}),
          ...(opts.phone !== undefined ? { phone: opts.phone } : {}),
          // Forward consent ONLY if the caller supplied it (from a real user
          // action). Never a blanket true — page load is not consent.
          ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
          _triggered_by: opts.ask,
        })) as { notification_id?: string | null; lead_ids?: string[] } & Record<string, unknown>;
        const leadIds = Array.isArray(r?.lead_ids) ? (r.lead_ids as string[]) : [];
        const notificationId = (r?.notification_id as string | undefined) ?? null;
        // The handle is the backend's own: notification_id for the job counters,
        // lead_ids for per-lead progress (and the only handle when the backend
        // returned no notification). Neither present → nothing was launched.
        job = notificationId || leadIds.length > 0 ? { notification_id: notificationId, lead_ids: leadIds } : null;
        if (!job) {
          // No job launched (nothing enrichable / preview-only / awaiting
          // confirmation) — terminal for this resource, not an error. Preserve
          // the FULL response (credits_remaining, would_launch, message,
          // next_action, mode, preview) so an artifact can render the spend
          // preview + re-call instructions on mode:"needs_confirmation" and
          // drive explicit consent (Codex P2) — don't reduce it to {mode,preview}.
          return { ...r, all_done: true, no_job: true };
        }
      }
      return call("leadbay_bulk_enrich_status", {
        ...(job.notification_id ? { notification_id: job.notification_id } : {}),
        ...(job.lead_ids.length > 0 ? { lead_ids: job.lead_ids } : {}),
        ...(opts.titles ? { titles: opts.titles } : {}),
        ...(opts.email !== undefined ? { email: opts.email } : {}),
        ...(opts.phone !== undefined ? { phone: opts.phone } : {}),
        _triggered_by: opts.ask,
      });
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
  /** Read page 0 on construction (default true). Pass false for a list the rep
   *  has not opened yet — see the note on LeadListOpts. */
  autoLoad?: boolean;
}
export interface LeadListOpts {
  lensId?: number;
  ask: string;
  pageSize?: number;
  /** A Field holding a LeadOrder string (from `lb.sortOrder()`), or a literal.
   *  Read at request time, so changing it and calling `.loadPage(0)` re-sorts. */
  order?: Field | string;
  /** Read page 0 on construction (default true). Pass false and call
   *  `.loadPage(0)` when the rep opens that tab.
   *
   *  A board with one list per lens constructs them all, so an eager default
   *  fires one read per lens before the rep has looked at anything. One real
   *  account's board did 42 `pull_leads` across 21 lenses on every open —
   *  2 MB and 32 s for the one list they were going to read. Defer the rest. */
  autoLoad?: boolean;
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
    autoLoad: opts.autoLoad,
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
    autoLoad: opts.autoLoad,
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

export interface SegmentOpts {
  /** Sector ids from `leadbay_list_sectors` — never a label. */
  sectorIds?: string[];
  /** Free text; the composite resolves it to an admin_area id via /geo/search. */
  city?: string;
  /** Pre-resolved admin_area id, when the caller already picked one. */
  cityId?: string;
  /** Whose book to count. `leadbay_pull_followups` defaults `personal` to
   *  FALSE — i.e. the whole ORGANISATION. On an admin's account that is a
   *  wildly different number from their own followups (one real account:
   *  7,232 org-wide vs 115 personal), and a board that says "your leads"
   *  while showing the org's is simply wrong. Pass it explicitly. */
  personal?: boolean;
  ask: string;
}

export interface SegmentCount {
  total: number;
  /** The filter the SERVER says is active. Compare it against what you sent —
   *  see the warning below. */
  applied: unknown;
  /** True when the server echoed back a filter that does not match the request,
   *  which means the write was rejected and this count answers a DIFFERENT
   *  question. Never chart a count whose `trusted` is false. */
  trusted: boolean;
}

export interface PortfolioSector {
  /** The sector id as it appears on a lead's `sector_id`. */
  id: string;
  /** Display name, resolved via `sectors`. Falls back to `Sector <id>` when
   *  the id is not in the taxonomy — invisible sectors are reachable only
   *  with includeInvisible, so an unresolved id is expected, not an error. */
  label: string;
  /** How many leads in the SAMPLE carried this sector. A sample count, not a
   *  portfolio total — call `segmentCount` for the exact figure. */
  sampled: number;
  /** Whether `label` came from the taxonomy or is a synthesised fallback. */
  resolved: boolean;
}

export interface PortfolioSectorsOpts {
  /** Leads to sample. One page is enough to surface the sectors that matter:
   *  in a 7,232-lead portfolio a 200-lead sample carried 91% of the leads in
   *  its top two sectors. Higher costs latency for little gain. */
  sample?: number;
  /** id → label, from `leadbay_list_sectors`. Embed it at build time: the
   *  visible taxonomy is ~1,346 entries and does not change between runs, so
   *  fetching it per page load buys nothing. */
  sectors?: Record<string, string>;
  /** Whose book to count. `leadbay_pull_followups` defaults `personal` to
   *  FALSE — i.e. the whole ORGANISATION. On an admin's account that is a
   *  wildly different number from their own followups (one real account:
   *  7,232 org-wide vs 115 personal), and a board that says "your leads"
   *  while showing the org's is simply wrong. Pass it explicitly. */
  personal?: boolean;
  ask: string;
}

/**
 * Which sectors does this user actually hold?
 *
 * There is no group-by on the Monitor, so the honest cheap answer is to read
 * `sector_id` off a page of real followups and tally it. Every lead carries
 * one, so a single call names the sectors worth offering — ordered by how much
 * of the user's own book sits in each, not by how big the sector is nationally.
 *
 * The alternative — paging all 7,232 leads at count:200 — is 37 calls to refine
 * an ordering the first page already gets right.
 *
 * NOTE the taxonomy's own `number_of_leads` is the WHOLE MARKET, not this
 * user's book (Supermarchés: 11,460 nationally vs 3,656 in one real portfolio).
 * Never show it as the user's number. This helper returns sample counts drawn
 * from the user's followups only.
 */
async function portfolioSectors(
  opts: PortfolioSectorsOpts,
): Promise<PortfolioSector[]> {
  const res = (await call("leadbay_pull_followups", {
    count: opts.sample ?? 200,
    filtered: false,
    ...(opts.personal === undefined ? {} : { personal: opts.personal }),
    _triggered_by: opts.ask,
  })) as { leads?: Array<{ sector_id?: unknown }> };

  const tally = new Map<string, number>();
  for (const lead of res.leads ?? []) {
    const raw = lead?.sector_id;
    if (raw == null || raw === "") continue;
    const id = String(raw);
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }

  const names = opts.sectors ?? {};
  return [...tally.entries()]
    .map(([id, sampled]) => {
      const hit = names[id];
      return {
        id,
        label: hit ?? `Sector ${id}`,
        sampled,
        resolved: hit != null,
      };
    })
    .sort((a, b) => b.sampled - a.sampled || a.id.localeCompare(b.id));
}

/**
 * Count the leads in one segment, cheaply: the Monitor filter plus `count: 1`,
 * so the answer is `pagination.total` and one throwaway row rather than a page.
 *
 * TWO TRAPS, both observed against the live API:
 *
 * 1. **The filter is server-side and STATEFUL.** `set_filter` overwrites one
 *    stored FilterItem per user, so consecutive calls are not independent —
 *    a later call inherits whatever the previous one stored. Always send the
 *    complete criteria set, never a delta.
 * 2. **A rejected criterion fails SILENTLY.** A malformed criterion leaves the
 *    previous filter in place and the call returns 200 with a count for the
 *    OLD question. That is why this returns `trusted`: it compares the echoed
 *    `active_filters` against what was sent, and a mismatch means the number
 *    is about something else.
 */
async function segmentCount(opts: SegmentOpts): Promise<SegmentCount> {
  const criteria: Array<Record<string, unknown>> = [];
  if (opts.sectorIds?.length) {
    criteria.push({ type: "sector_ids", sectors: opts.sectorIds, is_excluded: false });
  }
  const res = (await call("leadbay_pull_followups", {
    count: 1,
    set_filter: { criteria },
    ...(opts.city ? { city: opts.city } : {}),
    ...(opts.cityId ? { city_id: opts.cityId } : {}),
    ...(opts.personal === undefined ? {} : { personal: opts.personal }),
    _triggered_by: opts.ask,
  })) as {
    pagination?: { total?: number };
    active_filters?: { criteria?: Array<Record<string, unknown>> };
  };

  const applied = res.active_filters?.criteria ?? [];

  // Every criterion asked for must come back, whatever its type. An earlier
  // version compared sector ids only, which left the city path unguarded: with
  // `city` alone both sides of that comparison were the empty string, so a
  // silently-dropped location criterion read as trusted and the board charted a
  // count for a segment nobody asked for — the exact failure this flag exists to
  // catch.
  //
  // `city` / `cityId` are sent as top-level params, not criteria: the composite
  // resolves them through /geo/search into a `location_ids` criterion. So the
  // type to expect back is one this function never constructed.
  const wantTypes = new Set<string>();
  if (opts.sectorIds?.length) wantTypes.add("sector_ids");
  if (opts.city || opts.cityId) wantTypes.add("location_ids");

  const gotTypes = new Set(
    applied
      .map((c) => (typeof c?.type === "string" ? c.type : null))
      .filter((t): t is string => t != null),
  );

  // Sector VALUES are checked too, not just the type: a stale sector filter is
  // still a sector filter, so a type-only check would wave 5122 through when
  // 5134 was asked for. Locations get no value check — the id is resolved
  // server-side from free text, so the caller has nothing to compare against.
  const wantSectors = (opts.sectorIds ?? []).slice().sort().join(",");
  const gotSectors = applied
    .filter((c) => c?.type === "sector_ids")
    .flatMap((c) => (Array.isArray(c.sectors) ? (c.sectors as string[]) : []))
    .slice()
    .sort()
    .join(",");

  // The echo must match what was asked for in BOTH directions. Checking only
  // that everything wanted arrived is a subset test, and the stored filter is
  // cumulative: narrowing sector+city to sector-only leaves the location
  // criterion in force, so the count is still fenced to a city nobody asked
  // about while every requested type is present. An unrequested criterion
  // narrows the result exactly as a dropped one widens it.
  //
  // This also covers the unfiltered case on its own terms: with nothing wanted,
  // "nothing extra" IS "the echo is empty", which is what makes a whole-book
  // denominator trustworthy.
  const everyTypeLanded = [...wantTypes].every((t) => gotTypes.has(t));
  const nothingExtraApplied = [...gotTypes].every((t) => wantTypes.has(t));

  return {
    total: finite(res.pagination?.total),
    applied,
    trusted: everyTypeLanded && nothingExtraApplied && wantSectors === gotSectors,
  };
}

/** Manager team-activity (per-rep leaderboard + activity trend) for a window. */
function teamActivity(opts: { weeks?: number; ask: string }): Resource {
  return new Resource({
    load: () => call("leadbay_team_activity", { weeks: opts.weeks ?? 4, _triggered_by: opts.ask }),
  });
}

// ─── Rendering helpers ───────────────────────────────────────────────────────
//
// The library renders nothing by default — the artifact owns its markup. These
// three are the exception, and only because hand-rolling them goes wrong the
// same way every time: an SVG whose points escape the viewBox, a series that
// draws empty axes when it is empty, a leaderboard whose digits do not line up.
// Each returns a detached element the caller places; none injects itself.

const SVG_NS = "http://www.w3.org/2000/svg";
const svgNode = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
// Declared as a function, not a const arrow: segmentCount above uses it, and a
// const would be in the temporal dead zone at that point.
function finite(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

export interface TrendPoint {
  date?: string;
  count?: number;
  [k: string]: unknown;
}

export interface SparklineOpts {
  /** Accessible summary. Without one the chart is invisible to a screen reader. */
  label?: string;
  width?: number;
  height?: number;
  /** Shown in place of the chart when the series is empty — an empty window is
   *  a real answer, and empty axes read as a broken chart. */
  emptyTitle?: string;
  emptyHint?: string;
}

/**
 * A trend line as inline SVG, styled by the `lb-chart` classes so it takes its
 * colours from the theme and reads in light and dark alike. Returns an
 * `lb-empty` block instead when the series is empty.
 *
 * Inline rather than a charting library: a sparse series does not earn the
 * dependency, and a CDN chart that fails to load shows nothing at all.
 */
function sparkline(points: TrendPoint[] | null | undefined, opts: SparklineOpts = {}): HTMLElement | SVGElement {
  const data = Array.isArray(points) ? points : [];
  if (data.length === 0) {
    const box = document.createElement("div");
    box.className = "lb-empty";
    const t = document.createElement("div");
    t.className = "lb-empty-title";
    t.textContent = opts.emptyTitle ?? "Nothing in this window";
    box.appendChild(t);
    if (opts.emptyHint) {
      const h = document.createElement("div");
      h.className = "lb-empty-hint";
      h.textContent = opts.emptyHint;
      box.appendChild(h);
    }
    return box;
  }

  const W = opts.width ?? 640;
  const H = opts.height ?? 160;
  // Room for the y labels and the date row, so no drawn element or text can
  // escape the viewBox — the classic hand-rolled-chart bug.
  const L = 40, R = 8, T = 12, B = 26;
  const innerW = W - L - R;
  const innerH = H - T - B;
  const max = Math.max(1, ...data.map((p) => finite(p.count)));
  const x = (i: number) => (data.length === 1 ? L + innerW / 2 : L + (i / (data.length - 1)) * innerW);
  const y = (v: unknown) => T + innerH - (finite(v) / max) * innerH;

  const svg = svgNode("svg", {
    class: "lb-chart",
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": opts.label ?? `Trend across ${data.length} points, peak ${max}`,
  });

  // Baseline and peak only: a full grid competes with the series it frames.
  for (const v of [0, max]) {
    svg.appendChild(svgNode("line", { class: "lb-chart-grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const label = svgNode("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" });
    label.textContent = String(v);
    svg.appendChild(label);
  }

  const pts = data.map((p, i) => `${x(i)},${y(p.count)}`);
  svg.appendChild(
    svgNode("path", {
      class: "lb-chart-area",
      d: `M${x(0)},${y(0)} L${pts.join(" L")} L${x(data.length - 1)},${y(0)} Z`,
    }),
  );
  svg.appendChild(svgNode("path", { class: "lb-chart-line", d: `M${pts.join(" L")}` }));
  data.forEach((p, i) => {
    svg.appendChild(svgNode("circle", { class: "lb-chart-dot", cx: x(i), cy: y(p.count), r: 3 }));
  });

  // First and last only — every bucket labelled is unreadable at this width.
  const ends: Array<[number, string]> = data.length === 1 ? [[0, "middle"]] : [[0, "start"], [data.length - 1, "end"]];
  for (const [i, anchor] of ends) {
    const t = svgNode("text", { x: x(i), y: H - 8, "text-anchor": anchor });
    t.textContent = String(data[i].date ?? "").slice(0, 10);
    svg.appendChild(t);
  }
  return svg;
}

export interface TileSpec {
  label: string;
  value: string | number;
}

/** A row of headline figures. Only for the few numbers that ARE the point — a
 *  tile per field turns a dashboard into a wall. */
function tiles(specs: TileSpec[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "lb-tiles";
  for (const s of specs) {
    const tile = document.createElement("div");
    tile.className = "lb-tile";
    const l = document.createElement("span");
    l.className = "lb-tile-label";
    l.textContent = s.label;
    const v = document.createElement("span");
    v.className = "lb-tile-value";
    v.textContent = String(s.value);
    tile.append(l, v);
    wrap.appendChild(tile);
  }
  return wrap;
}

export interface LeaderboardColumn<T> {
  key: string;
  label: string;
  /** Numeric columns are end-aligned and tabular, so a column can be scanned. */
  num?: boolean;
  /** Render a cell yourself — e.g. a mailto link on the name. */
  cell?: (row: T) => Node | string;
}

export interface LeaderboardOpts<T> {
  rows: T[];
  columns: LeaderboardColumn<T>[];
  /** Initial sort. Client-side: the rows are already in hand. */
  sortKey?: string;
  sortDir?: "ascending" | "descending";
  /** Re-rendered on every header click, so the caller can swap the node. */
  onSort?: (key: string, dir: "ascending" | "descending") => void;
  emptyTitle?: string;
  emptyHint?: string;
}

/**
 * A sortable leaderboard. Sorting is CLIENT-side by design: a team roll-up
 * arrives whole, so re-sorting reorders data already held — unlike a lead
 * list, where the backend sorts the full set and returns one page of it.
 *
 * Header direction is carried in `aria-sort`, not by an arrow alone, and each
 * header is keyboard-operable.
 */
function leaderboard<T extends Record<string, unknown>>(opts: LeaderboardOpts<T>): HTMLElement {
  const { rows, columns } = opts;
  if (!rows || rows.length === 0) {
    const box = document.createElement("div");
    box.className = "lb-empty";
    const t = document.createElement("div");
    t.className = "lb-empty-title";
    t.textContent = opts.emptyTitle ?? "Nothing to show";
    box.appendChild(t);
    if (opts.emptyHint) {
      const h = document.createElement("div");
      h.className = "lb-empty-hint";
      h.textContent = opts.emptyHint;
      box.appendChild(h);
    }
    return box;
  }

  let key = opts.sortKey ?? columns[0].key;
  let dir: "ascending" | "descending" = opts.sortDir ?? "descending";

  const table = document.createElement("table");
  table.className = "lb-table";

  const draw = () => {
    table.textContent = "";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    for (const c of columns) {
      const th = document.createElement("th");
      th.textContent = c.label;
      if (c.num) th.setAttribute("data-num", "");
      th.setAttribute("aria-sort", c.key === key ? dir : "none");
      th.setAttribute("tabindex", "0");
      th.setAttribute("role", "button");
      const act = () => {
        if (key === c.key) dir = dir === "ascending" ? "descending" : "ascending";
        else {
          key = c.key;
          dir = c.num ? "descending" : "ascending";
        }
        draw();
        opts.onSort?.(key, dir);
      };
      th.addEventListener("click", act);
      th.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
          e.preventDefault();
          act();
        }
      });
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const sorted = rows.slice().sort((a, b) => {
      const A = a[key], B = b[key];
      if (typeof A === "string" || typeof B === "string") {
        const r = String(A ?? "").localeCompare(String(B ?? ""));
        return dir === "ascending" ? r : -r;
      }
      return dir === "ascending" ? finite(A) - finite(B) : finite(B) - finite(A);
    });

    const tbody = document.createElement("tbody");
    for (const row of sorted) {
      const tr = document.createElement("tr");
      tr.setAttribute("aria-selected", "false");
      for (const c of columns) {
        const td = document.createElement("td");
        if (c.num) td.setAttribute("data-num", "");
        const custom = c.cell?.(row);
        if (custom == null) td.textContent = c.num ? String(finite(row[c.key])) : String(row[c.key] ?? "—");
        else if (typeof custom === "string") td.textContent = custom;
        else td.appendChild(custom);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  };
  draw();

  // A wide table must scroll in its own container, never the page body.
  const wrap = document.createElement("div");
  wrap.style.overflowX = "auto";
  wrap.appendChild(table);
  return wrap;
}

// ─── Public surface ──────────────────────────────────────────────────────────

export const lb = {
  VERSION,
  configure,
  styles,
  call,
  // telemetry (product#4081) — `report` is exposed so an artifact can report a
  // failure the library cannot see (a render that threw, a control the agent
  // wired by hand). `setTelemetry(false)` opts this page out; the ACCOUNT-level
  // opt-out is enforced server-side and needs nothing here.
  report,
  setTelemetry,
  // primitives
  field: (cfg?: FieldConfig) => new Field(cfg),
  action: (cfg: ActionConfig) => new Action(cfg),
  resource: (cfg: ResourceConfig) => new Resource(cfg),
  list: (cfg: ListConfig) => new ListModel(cfg),
  // native-binding sugar
  bindSelect,
  bindValue,
  bindAction,
  // rendering helpers — the only three things the library draws, because
  // hand-rolling them goes wrong the same way every time
  sparkline,
  tiles,
  leaderboard,
  // domain components
  campaigns,
  segmentCount,
  portfolioSectors,
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
