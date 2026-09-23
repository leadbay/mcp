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

export const VERSION = "0.6.0";

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

/** The connector name the claude.ai `mcp` capability knows us by. A published
 *  artifact resolves connectors by their DISPLAY name, which is what the
 *  manifest's `servers[].server` carries. Override with
 *  `lb.configure({ server })` when the viewer's connector is named something
 *  else. */
const DEFAULT_MCP_SERVER = "Leadbay";
let mcpServerName: string = DEFAULT_MCP_SERVER;

/**
 * Bridge to the host. TWO transports, because the kit runs on two surfaces:
 *
 * - **cowork** injects `window.cowork.callMcpTool` — synchronous to obtain,
 *   and the only transport this kit had until now.
 * - **A published claude.ai artifact** has no `window.cowork`. It reaches the
 *   viewer's connectors through `window.claude.use("mcp")`, granted by the
 *   `capabilities.mcp` manifest declared at publish. Without this arm every
 *   kit artifact published to claude.ai threw `unavailable` on its first call
 *   and showed an empty board — the page looked built and reached no data.
 *
 * `use("mcp")` is ASYNC (and resolves `null` when the view cannot run it),
 * so this returns a CallFn that resolves the namespace on first use and
 * memoizes it. `call()` already awaits the result, so the async hop is free.
 */
function hostCall(): CallFn | null {
  const cw = (globalThis as { cowork?: { callMcpTool?: CallFn } }).cowork;
  if (cw && typeof cw.callMcpTool === "function") {
    return (tool, args) => cw.callMcpTool!(tool, args);
  }

  const claude = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (claude && typeof claude.use === "function") {
    return async (tool, args) => {
      const mcp = (await mcpNamespace(claude.use!)) as {
        callTool?: (s: string, t: string, i?: unknown) => Promise<{ payload?: unknown }>;
      } | null;
      if (!mcp || typeof mcp.callTool !== "function") {
        throw new LbError(
          "Leadbay is not reachable from this page — the artifact must declare the " +
            "Leadbay connector in its capabilities, and the viewer must have it enabled.",
          { code: "unavailable" },
        );
      }
      const res = await mcp.callTool(mcpServerName, tool, args);
      // `payload` is the documented home of the JSON most connectors return;
      // fall back to the whole envelope, which `normalize()` also understands.
      return res && "payload" in res && res.payload !== undefined ? res.payload : res;
    };
  }

  return null;
}

let mcpPromise: Promise<unknown> | null = null;
function mcpNamespace(use: (n: string) => Promise<unknown>): Promise<unknown> {
  if (!mcpPromise) mcpPromise = Promise.resolve(use("mcp")).catch(() => null);
  return mcpPromise;
}

// ─── Runtime telemetry (product#4081) ────────────────────────────────────────
//
// The artifact runs in a chat-hosted page: its ONLY channel out is
// window.cowork.callMcpTool, so every failure signal travels as an MCP tool
// call to `leadbay_report_artifact_error`. The server routes it the way the rest of
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

const TELEMETRY_TOOL = "leadbay_report_artifact_error";
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
export function configure(
  opts: { call?: CallFn; timeoutMs?: number; server?: string } = {},
): void {
  configuredCall = opts.call ?? null;
  timeoutMs = opts.timeoutMs ?? 30_000;
  // The connector's DISPLAY name, for the claude.ai `mcp` transport. Only
  // needed when the viewer's Leadbay connector is named something else.
  // RESET when absent, like every other option: an `if (opts.server)` guard
  // made this a one-way ratchet, so once a page called configure({server})
  // a later configure({}) could never restore the default — state leaking
  // across reconfigures and across tests.
  mcpServerName = opts.server ?? DEFAULT_MCP_SERVER;
  mcpPromise = null;
  // Caches keyed to the transport must not outlive it: a page that
  // reconfigures (or a test that swaps the stub) would otherwise keep a
  // taxonomy fetched through the previous one.
  sectorLabelsCache.clear();
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
    throw new LbError(
      "Leadbay bridge unavailable — no window.cowork and no window.claude.use(\"mcp\")",
      { code: "unavailable" },
    );
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

    // A native dialog is NOT available everywhere. In a sandboxed artifact
    // iframe `window.confirm` is commonly blocked: it returns false without
    // ever showing anything, so a confirmed action returned here silently and
    // the control read as a dead button — no dialog, no error, no message.
    // Distinguish the two outcomes: a real decline is silent (the rep knows
    // they said no), an unavailable dialog is an error the page can render.
    if (this.cfg.confirm) {
      if (typeof globalThis.confirm !== "function") {
        this.error = {
          message: "This action needs confirmation, which this page cannot show.",
          unavailable: false,
        };
        this.emit();
        report({ kind: "action_blocked", surface: "action", tool: this.cfg.tool });
        return undefined;
      }
      if (!globalThis.confirm(this.cfg.confirm)) return undefined;
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

export interface QualifyOpts {
  /** One lead, or `leadIds` for the bulk apply across checked rows. A thunk is
   *  evaluated at run() time, so a live checkbox selection works. */
  leadId?: string;
  leadIds?: string[] | (() => string[]);
  /** The user request this artifact serves — recorded as `_triggered_by`. */
  ask?: string;
  /** Whether this lead already carries an AI score. It changes only the WORD
   *  (`.label`): a scored lead is re-run, an unscored one is run for the first
   *  time. Pass a thunk when the card repaints after a launch. */
  scored?: boolean | (() => boolean);
  confirm?: string;
}

/** The label a Qualify/Requalify control must carry. "Requalify" is only
 *  honest once a verdict exists to replace — on an unscored lead it implies a
 *  previous run that never happened, and the rep reads the empty tag row as a
 *  failure of THIS button. A lead is scored when the qualifier has produced a
 *  verdict for it: `ai_agent_lead_score` on a list payload, or a
 *  `qualification_summary` with `answered > 0`. */
export function qualifyLabel(lead: unknown): "Qualify" | "Requalify" {
  const l = (lead ?? {}) as Record<string, any>;
  const score = l.ai_agent_lead_score;
  if (typeof score === "number" && score > 0) return "Requalify";
  const answered = l.qualification_summary?.answered;
  return typeof answered === "number" && answered > 0 ? "Requalify" : "Qualify";
}

/** bulk_qualify_leads action — the Qualify / Requalify button every lead card
 *  carries. Three things it owns so a hand-rolled version cannot get them
 *  wrong:
 *
 *  1. `leadIds` is camelCase. `lead_ids` is silently dropped by the schema,
 *     and with no ids the tool falls back to the LENS's unqualified wishlist —
 *     so the button appears to work while qualifying leads the rep never
 *     selected.
 *  2. `wait_for_completion: false`, so the click returns on QUEUE rather than
 *     holding through the poll. `.lastResult` therefore means "launched", not
 *     "verdict ready" — the card must say so and leave the old tags in place.
 *     `lb.qualifyStatus` is how you watch it finish.
 *  3. The launch fans out per lead and resolves 200 with a non-empty `failed[]`
 *     when some never started, exactly as `set_lead_status` does. Without the
 *     check the rep gets a green button over leads that were never queued.
 *     `quota_exceeded` is the same lie at the batch level: already-launched
 *     leads keep going, further launches stopped. */
function qualify(opts: QualifyOpts): Action {
  const ids = (): string[] => {
    const v = typeof opts.leadIds === "function" ? opts.leadIds() : opts.leadIds;
    if (Array.isArray(v)) return v;
    return opts.leadId ? [opts.leadId] : [];
  };
  // What was actually SUBMITTED, captured when args() ran. checkResult fires
  // after the round trip, and re-reading a live `leadIds` thunk there counts
  // the selection as it is NOW — so a rep who ticks another box mid-flight
  // gets "1 of 4 did not start" about a launch that only ever covered 3.
  let submitted = 0;
  const act = new Action({
    tool: "leadbay_bulk_qualify_leads",
    confirm: opts.confirm,
    args: () => {
      const leadIds = ids();
      submitted = leadIds.length;
      return {
        leadIds,
        wait_for_completion: false,
        ...(opts.ask ? { _triggered_by: opts.ask } : {}),
      };
    },
    checkResult: (r) => {
      const res = (r ?? {}) as {
        failed?: Array<{ lead_id?: string; error?: string }>;
        quota_exceeded?: boolean;
        launched_count?: number;
      };
      const failed = Array.isArray(res.failed) ? res.failed : [];
      const total = submitted;
      if (failed.length > 0) {
        // `failed[]` entries carry `error`, not `message` — set_lead_status
        // uses the other key, and reading the wrong one prints "undefined".
        const first = failed[0]?.error ?? "launch rejected";
        return failed.length >= total
          ? `Qualification did not start: ${first}`
          : `${failed.length} of ${total} leads did not start: ${first}`;
      }
      if (res.quota_exceeded) {
        const ok = res.launched_count ?? 0;
        return ok > 0
          ? `Quota reached — ${ok} of ${total} launched, the rest were not started.`
          : "Quota reached — no leads were queued.";
      }
      return null;
    },
  });
  // The label is a property of the control, not of the write, so it rides here
  // rather than forcing every card to re-derive it.
  //
  // A GETTER, not a value: `scored` is documented as accepting a thunk "when
  // the card repaints after a launch", and evaluating it once at construction
  // made that promise a lie — the word never changed. Reading it per access
  // means a card that re-renders after the verdict lands sees "Requalify".
  Object.defineProperty(act, "label", {
    enumerable: true,
    get: () =>
      (typeof opts.scored === "function" ? opts.scored() : opts.scored)
        ? "Requalify"
        : "Qualify",
  });
  return act;
}

/** Watches a launch returned by `lb.qualify`. Feed it the launch result; it
 *  polls `leadbay_qualify_status` until every lead settles. Without this the
 *  card can only ever say "queued" — the verdict lands minutes later. */
function qualifyStatus(
  launch: { notification_id?: string | null; lead_ids?: string[]; lens_id?: number },
  ask?: string,
  pollEvery = 15000,
): Resource {
  return new Resource({
    pollEvery,
    load: () =>
      call("leadbay_qualify_status", {
        ...(launch?.notification_id ? { notification_id: launch.notification_id } : {}),
        ...(launch?.lead_ids?.length ? { lead_ids: launch.lead_ids } : {}),
        ...(typeof launch?.lens_id === "number" ? { lens_id: launch.lens_id } : {}),
        ...(ask ? { _triggered_by: ask } : {}),
      }),
    until: (d) => {
      const r = (d ?? {}) as { still_running?: unknown[]; status?: string };
      if (Array.isArray(r.still_running)) return r.still_running.length === 0;
      return r.status != null && r.status !== "running";
    },
  });
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

/**
 * The sector taxonomy as `{id: label}`, fetched once per page and cached.
 *
 * `sector_id` on a lead is a RAW ID (`"5134"`) and the card contract forbids
 * printing it — but the taxonomy is ~1,091 visible rows, far too large to
 * inline in an artifact. So every board either embedded a hand-picked subset
 * (which goes stale and misses the sectors the user actually holds) or
 * dropped the sector line entirely. This makes the label available to every
 * artifact for the cost of one cached call.
 *
 * Resolves to `{}` when the call fails rather than rejecting: a missing
 * sector label degrades one line of a card, and should never take the board
 * down with it.
 */
// Keyed by `lang`, not a single slot. Unkeyed, a page whose first caller
// took the default and whose second asked for "fr" silently got the first
// call's labels back — no error, no cache miss, just the wrong language on
// every row. Different languages are different answers.
const sectorLabelsCache = new Map<string, Promise<Record<string, string>>>();
function sectorLabels(opts: { lang?: string } = {}): Promise<Record<string, string>> {
  const key = opts.lang ?? "";
  let cached = sectorLabelsCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const r = await call("leadbay_list_sectors", {
          ...(opts.lang ? { lang: opts.lang } : {}),
        });
        const list = Array.isArray(r)
          ? r
          : Array.isArray((r as { sectors?: unknown[] })?.sectors)
            ? (r as { sectors: unknown[] }).sectors
            : [];
        const out: Record<string, string> = {};
        for (const s of list) {
          const o = (s ?? {}) as { id?: unknown; label?: unknown };
          if (o.id != null && typeof o.label === "string" && o.label) {
            out[String(o.id)] = o.label;
          }
        }
        return out;
      } catch {
        return {};
      }
    })();
    sectorLabelsCache.set(key, cached);
  }
  return cached;
}

/**
 * The company-level context line every lead row shows: what the company does,
 * and how to reach the company itself.
 *
 * Both halves were previously left to each artifact, and both were got wrong
 * the same way. The sector came out as a raw id (`"5134"`) or was dropped;
 * the channels were either omitted — hiding a phone the rep could have dialled
 * immediately — or merged into the contact line, which claims a direct line
 * that does not exist. `phone_numbers` and `email` on a lead belong to the
 * COMPANY switchboard, not to `recommended_contact`.
 */
export interface LeadContext {
  /** `short_description`, else `description`, else the resolved sector label.
   *  Undefined when the lead carries none of the three. */
  summary?: string;
  /** The resolved sector label, when the taxonomy had it. */
  sector?: string;
  /** Company switchboard — NOT the contact's direct line. Label it as such. */
  phone?: string;
  /** Company email — same caveat. */
  email?: string;
}

/**
 * Build the context line for one lead. `labels` comes from `lb.sectorLabels()`;
 * pass `{}` and the sector is simply omitted rather than printed raw.
 *
 * Guards the literal string "null", which the API returns for a missing value
 * in `phone_numbers` AND in `email` — a row printing "☎ null" invites the rep
 * to dial nothing.
 */
export function leadContext(lead: unknown, labels: Record<string, string> = {}): LeadContext {
  const l = (lead ?? {}) as Record<string, any>;
  const real = (v: unknown) =>
    typeof v === "string" && v.trim() && v.trim() !== "null" ? v.trim() : undefined;

  const sector = l.sector_id != null ? labels[String(l.sector_id)] : undefined;
  const phones = Array.isArray(l.phone_numbers) ? l.phone_numbers : [];
  return {
    // Same fallback chain the card contract defines, stopping at the first
    // hit: short_description, then description, then the sector label.
    summary: real(l.short_description) ?? real(l.description) ?? sector,
    sector,
    phone: phones.map(real).find(Boolean),
    email: real(l.email),
  };
}

/** Where a lead board's rows come from. */
export type LeadSourceKind = "followups" | "discover" | "campaign";

export interface LeadSourceOpts {
  /** Read at load time, so changing it and calling `.loadPage(0)` re-sources
   *  without rebuilding the model. Pass a Field to bind it to a `<select>`. */
  kind: LeadSourceKind | Field | (() => LeadSourceKind);
  /** Required when kind is "campaign"; a Field binds it to a picker. */
  campaignId?: string | Field;
  /** Discover only. Omit for the active lens. */
  lensId?: number;
  /** Followups only. */
  city?: string;
  order?: Field | string;
  pageSize?: number;
  ask: string;
}

/**
 * ONE paginated list over any Leadbay source — the Monitor, a Discover lens,
 * or a campaign.
 *
 * `lb.callList` and `lb.leadList` each wrap one tool, which is right for a
 * board built for one job. A general lead board is the other case: the rep
 * picks where the rows come from, and everything downstream (the row's
 * contacts, status, outreach, qualify) is identical whichever they pick. Left
 * to the artifact, that switch means rebuilding a list model per source and
 * re-wiring every row.
 *
 * TWO THINGS DIFFER BY SOURCE and this owns both:
 *
 *  - The deep link's view. `pull_leads` rows are Discover, `pull_followups`
 *    rows carry `in_monitor` and belong on Monitor, and a campaign row needs
 *    `?campaign=<id>&lead=<id>`. `.leadUrl(lead)` answers it per row.
 *  - Sorting. A campaign call sheet has no `order` param, so the order is
 *    DROPPED for that source rather than sent and rejected.
 */
function leadSource(opts: LeadSourceOpts): ListModel & { leadUrl: (lead: unknown) => string } {
  const kindOf = (): LeadSourceKind => {
    const k = opts.kind;
    if (typeof k === "string") return k;
    if (typeof k === "function") return k();
    return (String(k?.value ?? "followups") as LeadSourceKind) || "followups";
  };
  const campaignOf = (): string | undefined => {
    const c = opts.campaignId;
    const v = typeof c === "string" ? c : c?.value;
    return v ? String(v) : undefined;
  };
  const orderOf = (): string =>
    typeof opts.order === "string" ? opts.order : String(opts.order?.value ?? "");

  const model = new ListModel({
    pageSize: opts.pageSize ?? 20,
    load: async ({ page, pageSize }) => {
      const kind = kindOf();
      let r: unknown;
      if (kind === "campaign") {
        const campaignId = campaignOf();
        if (!campaignId) return { items: [], total: 0 };
        // No `order`: leadbay_campaign_call_sheet has no such param and
        // sending one is rejected.
        r = await call("leadbay_campaign_call_sheet", {
          campaign_id: campaignId,
          page,
          count: pageSize,
          _triggered_by: opts.ask,
        });
      } else if (kind === "discover") {
        r = await call("leadbay_pull_leads", {
          page,
          count: pageSize,
          ...(opts.lensId ? { lensId: opts.lensId } : {}),
          ...(orderOf() ? { order: orderOf() } : {}),
          _triggered_by: opts.ask,
        });
      } else {
        r = await call("leadbay_pull_followups", {
          page,
          count: pageSize,
          ...(opts.city ? { city: opts.city } : {}),
          ...(orderOf() ? { order: orderOf() } : {}),
          _triggered_by: opts.ask,
        });
      }
      const o = (r ?? {}) as {
        leads?: unknown[];
        items?: unknown[];
        total_leads?: number;
        pagination?: { total?: number };
      };
      const items = o.leads ?? o.items ?? [];
      return { items, total: o.pagination?.total ?? o.total_leads ?? items.length };
    },
  });

  return Object.assign(model, {
    leadUrl: (lead: unknown): string => {
      const l = (lead ?? {}) as { id?: string; in_monitor?: boolean };
      const id = encodeURIComponent(String(l.id ?? ""));
      const kind = kindOf();
      if (kind === "campaign") {
        const c = campaignOf();
        // Omitting `campaign=` opens an empty campaign view.
        if (c) return `https://leadbay.app/app/campaign?campaign=${encodeURIComponent(c)}&lead=${id}`;
      }
      // `pull_leads` omits in_monitor entirely; its rows are Discover by
      // definition. A followups row carries in_monitor:true.
      const view = kind === "discover" ? "discover" : l.in_monitor === false ? "discover" : "monitor";
      return `https://leadbay.app/app/${view}?lead=${id}`;
    },
  });
}

/** One contact a rep can actually reach, flattened from a lead profile. */
export interface RelanceContact {
  contactId?: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  /** The contact's LinkedIn profile. A ROUTE the rep can take — show it — but
   *  NOT a channel for reachability counting: it cannot be dialled or mailed,
   *  and `lb.leadReach` deliberately ignores it. Both rules are right; they
   *  answer different questions ("can I contact this person right now" vs
   *  "how much of the book is callable"). */
  linkedin?: string;
  /** The row's default target: the contact's own `recommended` flag, falling
   *  back to the engagement block's `recommended_contact` id. */
  recommended: boolean;
  /** True when a channel has already been purchased for this contact
   *  (`enrichment_done`). False means enrichment would buy one. */
  enriched: boolean;
}

/**
 * Everything one row of a relance (follow-up) table needs, as one object.
 *
 * A relance row is not a lead card: the rep is not deciding whether the lead
 * fits, they are deciding who to call and recording what happened. So the row
 * bundles four things that were previously four separate wirings each artifact
 * assembled by hand — and got subtly wrong in the same places:
 *
 *   `contacts`  who to reach, with the CHANNELS (lazy — see below)
 *   `status`    the org-wide CRM outcome     → lb.setStatus
 *   `epilogue`  how this attempt went        → lb.outreach
 *   `note`      what was said                → gated, required to log
 *
 * TWO SYSTEMS, NOT ONE. Epilogue is how one outreach ATTEMPT went and drives
 * follow-up ranking; lead status is the commercial outcome the whole org sees.
 * Setting one never sets the other, so a row exposes both and a rep reporting
 * "she's interested, meeting booked" fires both actions.
 *
 * CHANNELS ARE LAZY, BY NECESSITY. The list payloads (`pull_followups`,
 * `campaign_call_sheet`) carry `recommended_contact` as a NAME and nothing
 * else — no email, no phone. Those live on `research_lead_by_id` as
 * `contacts.reachable[]`. Prefetching them for a 20-row table means 20
 * requests to fill cells the rep may never read, so `contacts` is a Resource
 * with `autoLoad:false`: the row renders instantly from the list, and the
 * channels load when the rep opens that row. One call for one lead they chose.
 */
export interface RelanceRow {
  leadId: string;
  /** Lazy: `.load()` on the rep's gesture. `.data` is RelanceContact[]. */
  contacts: Resource;
  /** Company-level context, loaded automatically: `.data` is a LeadContext
   *  (summary / sector / company phone / company email). Present only when
   *  `lead` was passed. */
  context: Resource;
  /** CRM status field + its write. Saves on change; no submit button. */
  status: Field;
  saveStatus: Action;
  /** Epilogue select + note + the write that needs both. */
  epilogue: Field;
  note: Field;
  logOutreach: Action;
  /** Taste — an axis INDEPENDENT of CRM status. A lead can be liked and lost. */
  like: Action;
  dislike: Action;
  /** Qualify / Requalify. `qualify.label` carries which word to show. */
  qualify: Action;
}

export function relanceRow(opts: {
  leadId: string;
  ask: string;
  /** The lead's current `state.status`, so the select opens on it. */
  currentStatus?: string | null;
  /** The lead row from the list payload. Pass it and the row resolves its own
   *  `context` (sector label, description, company switchboard) so an artifact
   *  does not have to wire that separately. */
  lead?: unknown;
}): RelanceRow {
  const status = leadStatus(opts.currentStatus);
  const epilogue = new Field({
    kind: "select",
    value: EPILOGUE_STATUSES[0],
    load: async () =>
      EPILOGUE_STATUSES.map((v) => ({
        value: v,
        label: EPILOGUE_LABELS[v] ?? v,
      })),
  });
  // Gated: report_outreach without a note records that something happened and
  // not what, which is worse than no record — the next rep reads an empty
  // follow-up and calls blind.
  const note = new Field({
    validate: (v) => (String(v ?? "").trim() ? null : "Add a note before logging"),
  });

  const contacts = new Resource({
    autoLoad: false,
    load: async () => {
      const r = (await call("leadbay_research_lead_by_id", {
        leadId: opts.leadId,
        _triggered_by: opts.ask,
      })) as {
        contacts?: { reachable?: unknown[]; candidates?: unknown[] };
        engagement?: { recommended_contact?: { contact_id?: string } };
      };

      // The contact set is TWO-TIER: `reachable` holds contacts with a
      // purchased channel, `candidates` holds everyone known. On an
      // un-enriched book `reachable` is EMPTY and every contact sits in
      // `candidates` — reading only `reachable` renders "no contacts" for a
      // lead with nine of them. Show both, reachable first, de-duplicated by
      // id in case a contact appears in each.
      const reachable = Array.isArray(r?.contacts?.reachable) ? r.contacts!.reachable! : [];
      const candidates = Array.isArray(r?.contacts?.candidates) ? r.contacts!.candidates! : [];
      const seen = new Set<string>();
      const list: unknown[] = [];
      for (const c of [...reachable, ...candidates]) {
        const id = (c as { id?: string; contact_id?: string })?.id
          ?? (c as { contact_id?: string })?.contact_id;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        list.push(c);
      }

      // TWO sources disagree about who is recommended, and they are both real:
      // a contact's own `recommended: true` flag, and the engagement block's
      // `recommended_contact` (the ORG contact the Monitor row shows). On one
      // observed lead they named different people. The contact's own flag wins
      // — it is per-contact and is what the research payload asserts about
      // this set — and the engagement id is the fallback for payloads that
      // omit the flag. Note it lives under `engagement`, NOT at the top level.
      const engagementId = r?.engagement?.recommended_contact?.contact_id;
      return list.map((c) => flattenContact(c, engagementId));
    },
  });

  // Company context resolves against the cached taxonomy, so N rows share one
  // fetch. Synchronous callers get the channels immediately (they are on the
  // list payload) and the sector label once the taxonomy lands.
  const context = new Resource({
    load: async () => leadContext(opts.lead, await sectorLabels()),
  });

  return {
    leadId: opts.leadId,
    contacts,
    context,
    status,
    saveStatus: setStatus({ leadId: opts.leadId, status, ask: opts.ask }),
    epilogue,
    note,
    logOutreach: outreach({ leadId: opts.leadId, ask: opts.ask, status: epilogue, note }),
    like: like(opts.leadId),
    dislike: dislike(opts.leadId),
    // Label comes from the lead's own score, so a never-qualified lead is not
    // offered a "re-run" that never ran.
    qualify: qualify({
      leadId: opts.leadId,
      ask: opts.ask,
      scored: qualifyLabel(opts.lead) === "Requalify",
    }),
  };
}

/**
 * Reveal one contact's email, phone, or both — the action a relance row
 * offers on a contact with no channel.
 *
 * SPENDS QUOTA, so it carries a `confirm` by default. Enrichment is gated
 * server-side per organisation and a reveal is not free; a rep clicking
 * through a table should be told which channels they are buying, for whom,
 * before the call goes out. Pass `confirm: ""` to suppress it only when the
 * surrounding UI has already asked.
 *
 * `email` and `phone` both default TRUE on the tool, and it rejects a call
 * with both false. This component surfaces them as explicit choices instead,
 * because "both" is the expensive default and a rep who only needs a phone
 * should be able to say so.
 *
 * WHAT COMES BACK IS NOT ALWAYS THE SAME ROW. For a `source:"paid"`
 * candidate the channel lands on a NEW `source:"org"` contact with a
 * DIFFERENT id — the candidate row itself only flips `enrichment_done`. So
 * after a successful reveal, re-load the lead's contacts rather than patching
 * the row in place: `onDone` fires for exactly that, and
 * `relanceRow.contacts.load()` is what to call. Note also that
 * `enrichment_done: true` alone does not mean the requested channel arrived —
 * a contact enriched earlier for the other channel already reads done.
 */
export function enrichContact(opts: {
  leadId: string;
  contactId: string;
  /** Which channels to buy. Both default true, matching the tool. */
  email?: boolean | (() => boolean);
  phone?: boolean | (() => boolean);
  ask?: string;
  /** Override the spend confirmation; "" disables it. */
  confirm?: string;
  /** Re-load the contact set here — the channel may land on a NEW contact. */
  onDone?: () => void;
}): Action {
  const want = (v: boolean | (() => boolean) | undefined) =>
    typeof v === "function" ? v() : v !== false;
  // The tool rejects email:false + phone:false. A Field validates BEFORE the
  // call, so the rep gets a sentence instead of a schema error — and before
  // the confirm dialog, so they are not asked to approve a spend that cannot
  // happen.
  const channels = new Field({
    value: "ok",
    validate: () => (want(opts.email) || want(opts.phone) ? null : "Pick email, phone, or both."),
  });
  return new Action({
    tool: "leadbay_enrich_contacts",
    fields: [channels],
    confirm:
      opts.confirm === "" ? undefined : (opts.confirm ?? "Reveal this contact? It uses enrichment quota."),
    // `_triggered_by` IS accepted here — the MCP-exposed schema carries it as
    // optional metadata, even though the raw inputSchema in the tool source
    // does not list it. Verified against a live call.
    args: () => ({
      leadId: opts.leadId,
      contactId: opts.contactId,
      email: want(opts.email),
      phone: want(opts.phone),
      ...(opts.ask ? { _triggered_by: opts.ask } : {}),
    }),
    checkResult: (r) => {
      const res = (r ?? {}) as { error?: unknown; message?: string };
      return res.error ? (res.message ?? "Enrichment failed") : null;
    },
    onSuccess: () => opts.onDone?.(),
  });
}

/** The four epilogue values in the rep's words. The raw enum names are
 *  shouted constants; a select showing INTEREST_VALIDATED_OR_MEETING_PLANED
 *  makes the rep translate before they can answer. */
export const EPILOGUE_LABELS: Record<string, string> = {
  STILL_CHASING: "Still chasing",
  COULD_NOT_REACH_STILL_TRYING: "Could not reach — still trying",
  INTEREST_VALIDATED_OR_MEETING_PLANED: "Interested / meeting planned",
  NOT_INTERESTED_LOST: "Not interested — lost",
};

/** Flatten one profile contact to the fields a relance row shows. Guards the
 *  literal "null" string the API returns for a missing value, in every channel
 *  field — a row printing "☎ null" invites the rep to dial nothing. */
function flattenContact(c: unknown, recommendedId?: string): RelanceContact {
  const o = (c ?? {}) as Record<string, any>;
  const real = (v: unknown) =>
    typeof v === "string" && v.trim() && v !== "null" ? v.trim() : undefined;
  const name =
    [real(o.first_name), real(o.last_name)].filter(Boolean).join(" ") ||
    real(o.name) ||
    "Unnamed contact";
  const id = real(o.id) ?? real(o.contact_id);
  return {
    contactId: id,
    name,
    title: real(o.job_title) ?? real(o.title),
    email: real(o.email),
    phone: real(o.phone) ?? real(o.phone_number) ?? real((o.phone_numbers ?? [])[0]),
    linkedin: real(o.linkedin_page),
    // The contact's own flag first — it is what this payload asserts about
    // this set. The engagement id is the fallback for a contact that carries
    // no flag at all.
    recommended:
      o.recommended === true || (recommendedId != null && id === recommendedId),
    /** True once a channel has been purchased for this contact. A candidate
     *  with `enrichment_done:false` and no channel is not a dead end — it is
     *  exactly what enrichment buys. */
    enriched: o.enrichment_done === true,
  };
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
/**
 * The counting primitive both `segmentCount` and `coverage` sit on: one
 * filtered `pagination.total`, with the echo of the stored filter verified
 * against what was sent.
 *
 * Kept generic over criteria so a dimension this file has never heard of —
 * a size band, a custom field — gets the same guarantee as a sector. The
 * comparison is by TYPE in both directions, plus values for the types where
 * the caller has something to compare against (see `valueKey`).
 */
async function segmentCountRaw(opts: {
  criteria: Array<Record<string, unknown>>;
  personal?: boolean;
  ask: string;
  city?: string;
  cityId?: string;
}): Promise<SegmentCount> {
  const res = (await call("leadbay_pull_followups", {
    count: 1,
    set_filter: { criteria: opts.criteria },
    ...(opts.city ? { city: opts.city } : {}),
    ...(opts.cityId ? { city_id: opts.cityId } : {}),
    ...(opts.personal === undefined ? {} : { personal: opts.personal }),
    _triggered_by: opts.ask,
  })) as {
    pagination?: { total?: number };
    active_filters?: { criteria?: Array<Record<string, unknown>> };
  };

  const applied = res.active_filters?.criteria ?? [];
  const typeOf = (c: Record<string, unknown>) =>
    typeof c?.type === "string" ? (c.type as string) : null;

  const wantTypes = new Set<string>();
  for (const c of opts.criteria) {
    const t = typeOf(c);
    if (t) wantTypes.add(t);
  }
  // city/cityId are top-level params the composite resolves via /geo/search
  // into a location_ids criterion — a type this function never constructed.
  if (opts.city || opts.cityId) wantTypes.add("location_ids");

  const gotTypes = new Set(
    applied.map(typeOf).filter((t): t is string => t != null),
  );

  // Both directions. "Everything I asked for arrived" is only a subset test,
  // and the stored filter is cumulative: an unrequested criterion left over
  // from the previous call narrows the count exactly as a dropped one widens
  // it. With nothing wanted, "nothing extra" IS "the echo is empty", which is
  // what makes the whole-book denominator trustworthy.
  const everyTypeLanded = [...wantTypes].every((t) => gotTypes.has(t));
  const nothingExtra = [...gotTypes].every((t) => wantTypes.has(t));

  // VALUES, not just types. A stale filter of the right type is still the
  // wrong question: sector 5122 echoed when 5134 was asked for, a size band
  // 1–10 echoed when 20–49 was asked for. A type-only check waves both
  // through, which is how a size sweep can return the same number twelve
  // times and look plausible.
  //
  // Compared structurally so a dimension this file has never seen is covered
  // by default — the alternative is an allowlist of value keys, and a
  // criterion type missing from it silently loses its value check. Opting a
  // type IN by accident costs a false `trusted:false`; leaving one OUT costs
  // a charted wrong number, so the default must be to check.
  //
  // `location_ids` is the one deliberate exemption: the caller sends free
  // text (`city`) and the server resolves it to an admin_area id through
  // /geo/search, so the echo legitimately differs from anything sent and
  // there is nothing to compare against. Presence is still required above.
  const UNCOMPARABLE = new Set(["location_ids"]);
  const canon = (list: Array<Record<string, unknown>>, type: string): string =>
    list
      .filter((c) => typeOf(c) === type)
      .map((c) =>
        JSON.stringify(
          Object.keys(c)
            .filter((k) => k !== "type")
            .sort()
            .map((k) => [k, c[k]]),
        ),
      )
      .sort()
      .join("|");
  const valuesMatch = [...wantTypes].every(
    (t) => UNCOMPARABLE.has(t) || canon(opts.criteria, t) === canon(applied, t),
  );

  return {
    total: finite(res.pagination?.total),
    applied,
    trusted: everyTypeLanded && nothingExtra && valuesMatch,
  };
}

async function segmentCount(opts: SegmentOpts): Promise<SegmentCount> {
  const criteria: Array<Record<string, unknown>> = [];
  if (opts.sectorIds?.length) {
    criteria.push({ type: "sector_ids", sectors: opts.sectorIds, is_excluded: false });
  }
  return segmentCountRaw({
    criteria,
    personal: opts.personal,
    ask: opts.ask,
    city: opts.city,
    cityId: opts.cityId,
  });
}


/** One value of a coverage dimension: the thing a bar measures. */
export interface CoverageBucket {
  /** Stable key — a sector id, a size band name, a custom-field value. */
  id: string;
  /** What the bar is labelled. */
  label: string;
  /** The FilterCriterion this bucket narrows by. Omit for a whole-book row.
   *  It must be complete on its own: the stored filter is cumulative and this
   *  runner always sends the full set, never a delta. */
  criterion?: Record<string, unknown>;
  /** Optional ordering hint from a sample (see `coverageBuckets`). Never
   *  presented as the portfolio figure — `segmentCount` gives that. */
  sampled?: number;
}

/** One measured bucket. `trusted:false` means the server echoed a filter that
 *  did not match what was sent, so the number answers a different question and
 *  MUST be shown as unmeasured rather than charted. */
export interface CoverageRow extends CoverageBucket {
  total: number;
  trusted: boolean;
  error?: string;
}

export interface CoverageOpts {
  /** The buckets to measure, in render order. */
  buckets: CoverageBucket[];
  ask: string;
  /** Whose book. `pull_followups` defaults to the whole ORGANISATION; on an
   *  admin account that is a different number from their own followups. */
  personal?: boolean;
  /** Called after each bucket settles, for a progress cue. Measuring is
   *  SEQUENTIAL by design — see below. */
  onProgress?: (done: number, total: number, row: CoverageRow) => void;
}

/**
 * Measure any dimension of the Monitor portfolio — sector, size, recency,
 * liked, a custom field — as a list of counted buckets.
 *
 * This is `segmentCount` generalised. It owns the three things that make a
 * hand-rolled multi-segment board wrong:
 *
 * 1. **Sequential, never a parallel burst.** A filtered count is normally
 *    1–2s, but a `last_action_date` criterion was observed at 54s on a 3.6k
 *    segment. Twelve of those in parallel is a hung page and a hammered
 *    backend. `onProgress` exists so the UI can show the sweep advancing
 *    instead of freezing.
 * 2. **The complete criteria set on every call.** The stored Monitor filter is
 *    a single server-side slot and CUMULATIVE: send bucket B as a delta after
 *    bucket A and B inherits A's criterion, so every bar after the first is
 *    fenced by the one before it. Each call here sends exactly its own
 *    bucket's criterion and nothing else.
 * 3. **Per-bucket echo verification.** A rejected criterion returns 200 with
 *    the PREVIOUS filter still applied — a plausible number answering the
 *    previous question. Each row carries its own `trusted`.
 *
 * A bucket that throws becomes a row with `trusted:false` and an `error`
 * rather than aborting the sweep: one unmeasurable segment should not cost
 * the other eleven.
 */
async function coverage(opts: CoverageOpts): Promise<CoverageRow[]> {
  const rows: CoverageRow[] = [];
  const total = opts.buckets.length;

  for (const bucket of opts.buckets) {
    let row: CoverageRow;
    try {
      const measured = await segmentCountRaw({
        criteria: bucket.criterion ? [bucket.criterion] : [],
        personal: opts.personal,
        ask: opts.ask,
      });
      row = { ...bucket, total: measured.total, trusted: measured.trusted };
    } catch (e) {
      row = { ...bucket, total: 0, trusted: false, error: messageOf(e) };
    }
    rows.push(row);
    opts.onProgress?.(rows.length, total, row);
  }

  return rows;
}

/** The whole-book denominator: one unfiltered count, at the same scope as the
 *  buckets. Taken UNFILTERED on purpose, so it ignores whatever filter the
 *  user's Monitor tab happens to have applied — a denominator that moves with
 *  the UI makes every share meaningless. */
async function coverageTotal(opts: { ask: string; personal?: boolean }): Promise<CoverageRow> {
  try {
    const m = await segmentCountRaw({ criteria: [], personal: opts.personal, ask: opts.ask });
    return { id: "__all__", label: "Whole book", total: m.total, trusted: m.trusted };
  } catch (e) {
    return { id: "__all__", label: "Whole book", total: 0, trusted: false, error: messageOf(e) };
  }
}

/**
 * Derive a dimension's buckets from the leads the user ACTUALLY holds, by
 * sampling one page and tallying a field.
 *
 * `portfolioSectors` generalised. Never hardcode a bucket list: the guide
 * records what that did to one real portfolio — a hand-written list offered a
 * sector holding 3 leads while omitting the third-largest at 555. The same
 * applies to size bands and custom-field values, where the plausible-looking
 * list is even easier to invent.
 *
 * `sampled` orders the list; it is NOT the portfolio figure. Pass the buckets
 * to `coverage` for real counts.
 */
async function coverageBuckets(opts: {
  /** Lead field to tally (`sector_id`, or a custom field's key). */
  field: string;
  /** id → display label. Unresolved ids fall back to `<field> <id>`. */
  labels?: Record<string, string>;
  /** Build the FilterCriterion for a tallied value. */
  criterion?: (id: string) => Record<string, unknown>;
  sample?: number;
  personal?: boolean;
  ask: string;
  /** Keep at most N buckets, highest sample first. A sweep is sequential, so
   *  an unbounded list is an unbounded wait. */
  limit?: number;
}): Promise<CoverageBucket[]> {
  const res = (await call("leadbay_pull_followups", {
    count: opts.sample ?? 200,
    filtered: false,
    ...(opts.personal === undefined ? {} : { personal: opts.personal }),
    _triggered_by: opts.ask,
  })) as { leads?: Array<Record<string, unknown>> };

  const tally = new Map<string, number>();
  for (const lead of res.leads ?? []) {
    const raw = lead?.[opts.field];
    if (raw == null || raw === "" || raw === "null") continue;
    const id = String(raw);
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }

  const labels = opts.labels ?? {};
  const out = [...tally.entries()]
    .map(([id, sampled]) => ({
      id,
      label: labels[id] ?? `${opts.field} ${id}`,
      sampled,
      ...(opts.criterion ? { criterion: opts.criterion(id) } : {}),
    }))
    .sort((a, b) => b.sampled - a.sampled || a.id.localeCompare(b.id));

  return opts.limit != null ? out.slice(0, opts.limit) : out;
}

/** The reachability of one lead, as a list payload can report it. */
export type Reach = "reachable" | "contacts_only" | "empty";

/** Classify one lead's reachability from a list payload.
 *
 * The distinction this exists to make: **`contacts_count > 0` is NOT
 * reachability.** It counts known PEOPLE — a name and a job title — not
 * people you can dial. A lead can show 2,518 contacts and zero channels, and
 * a board that charts `contacts_count` tells a rep they have a pipeline when
 * they have a phone book with no numbers. Nor is a `linkedin_page`: the rep
 * cannot message a URL without leaving the artifact.
 *
 * So three states, not two:
 *   - `reachable`      a company phone or email exists — callable today
 *   - `contacts_only`  people are known, no channel — ENRICHMENT BUYS THIS
 *   - `empty`          neither — needs discovery before enrichment
 *
 * The middle bucket is the point. It is the only one where spending money
 * converts a dead row into a callable one, so it is the board's whole answer
 * to "what should I buy?".
 *
 * `has_phone` is the ready-made boolean on `pull_followups`; `pull_leads`
 * omits it, so `phone_numbers` is the fallback. The API returns the literal
 * STRING "null" for a missing value in `phone_numbers` AND in `email`, so
 * both are guarded — without it a lead with `phone_numbers:["null"]` counts
 * as reachable and the board overstates the callable book. */
export function leadReach(lead: unknown): Reach {
  const l = (lead ?? {}) as Record<string, any>;
  const real = (v: unknown) => (typeof v === "string" && v && v !== "null" ? v : null);

  const phones = Array.isArray(l.phone_numbers) ? l.phone_numbers : [];
  const hasPhone = l.has_phone === true || phones.some((p: unknown) => real(p) != null);
  const hasEmail = real(l.email) != null;
  if (hasPhone || hasEmail) return "reachable";

  const known = finite(l.contacts_count) + finite(l.org_contacts_count);
  return known > 0 ? "contacts_only" : "empty";
}

export interface ReachCoverage {
  rows: CoverageRow[];
  /** How many leads were classified. This is a SAMPLE, never the book. */
  sampled: number;
  /** The book's real size, from an unfiltered count — the denominator to
   *  extrapolate against, and the number that makes the sample honest. */
  bookTotal: number;
}

/**
 * Reachability coverage: how much of the book is callable, how much is one
 * enrichment away, how much is neither.
 *
 * WHY THIS ONE IS SAMPLED, unlike every other coverage dimension: reachability
 * is not a `FilterCriterion`. The Monitor cannot filter on "has a phone", so
 * there is no cheap `pagination.total` for it and the counts have to come from
 * classifying real leads. That makes this an ESTIMATE — `sampled` says over
 * how many, and `bookTotal` gives the real denominator, so a caller can
 * extrapolate and label it honestly. Never present these as exact counts; the
 * board must say "≈ 62% of 7,078, sampled over 200".
 *
 * One page, one call. The sample is taken UNFILTERED so the shape is the
 * book's, not whatever the user's Monitor tab currently has applied.
 */
async function reachCoverage(opts: {
  sample?: number;
  personal?: boolean;
  ask: string;
}): Promise<ReachCoverage> {
  const sample = opts.sample ?? 200;
  const res = (await call("leadbay_pull_followups", {
    count: sample,
    filtered: false,
    ...(opts.personal === undefined ? {} : { personal: opts.personal }),
    _triggered_by: opts.ask,
  })) as { leads?: unknown[]; pagination?: { total?: number } };

  const leads = Array.isArray(res.leads) ? res.leads : [];
  const tally: Record<Reach, number> = { reachable: 0, contacts_only: 0, empty: 0 };
  for (const lead of leads) tally[leadReach(lead)]++;

  const LABELS: Array<[Reach, string]> = [
    ["reachable", "Callable now"],
    ["contacts_only", "Contacts, no channel"],
    ["empty", "No contacts"],
  ];

  return {
    sampled: leads.length,
    // The page's own pagination.total IS the unfiltered book, so this costs
    // no extra call — the denominator rides along with the sample.
    bookTotal: finite(res.pagination?.total),
    rows: LABELS.map(([id, label]) => ({
      id,
      label,
      total: tally[id],
      // A classified sample is as trustworthy as the read that produced it:
      // there is no stored filter to echo, so nothing can silently answer a
      // different question the way segmentCountRaw guards against.
      trusted: true,
      sampled: tally[id],
    })),
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
  // Coverage: any dimension the Monitor filter can narrow by, not just sector.
  // `coverageBuckets` derives the values from the book (never hardcode them),
  // `coverage` sweeps them sequentially with a per-bucket trusted check, and
  // `coverageTotal` is the unfiltered denominator.
  coverage,
  coverageBuckets,
  coverageTotal,
  // Reachability — the one coverage dimension the Monitor cannot filter on,
  // so it is SAMPLED and its rows are an estimate against `bookTotal`.
  reachCoverage,
  leadReach,
  outreach,
  note: noteAction,
  like,
  dislike,
  // Qualify / Requalify — mandatory on every lead card. `qualifyLabel` picks
  // the word from the lead's own data so a card never offers to "re-run" a
  // qualification that never ran.
  qualify,
  qualifyLabel,
  qualifyStatus,
  leadStatus,
  setStatus,
  // Relance (follow-up) table: one row's contacts + status + epilogue + note,
  // bundled so an artifact wires a row once instead of five times.
  relanceRow,
  enrichContact,
  // Company-level context for a lead row: what it does (resolved sector /
  // description) and the company switchboard. `sectorLabels` caches the
  // taxonomy so no artifact has to inline or omit it.
  sectorLabels,
  leadContext,
  EPILOGUE_LABELS,
  sortOrder,
  leadHistory,
  leadProfile,
  enrichment,
  callList,
  leadList,
  // One list over ANY source (Monitor / Discover lens / campaign), with the
  // per-source deep link and the campaign's no-sort rule built in.
  leadSource,
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
