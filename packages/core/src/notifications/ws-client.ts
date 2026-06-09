// Backend notifications WS listener.
//
// Wire contract (confirmed from backend/websocket/WebSocketRoutes.kt
// and backend/routes/AuthRoutes.kt::authRoutes):
//
//   1. GET /1.5/auth/ws?v=1.0 (bearer-authed) → { url } carrying a
//      one-shot `?t=<ticket>` query param.
//   2. Open WS to that URL. Server filters per-user via Redis fanout, so
//      only this user's frames arrive.
//   3. Frames are JSON keyed by `type`. We care about `type:"notification"`
//      and the payload matches `NotificationPayload`.
//   4. The server sends PING/PONG frames; the client must respond to PING
//      with PONG, and may proactively PING every ~30s.
//
// On disconnect: capped exponential backoff (1s → 30s) and a re-fetched
// ticket each reconnect (tickets are single-use).
//
// Uses the Node 22+ global WebSocket — no external dep.

import type { LeadbayClient } from "../client.js";
import type { Notification, ToolLogger } from "../types.js";
import type { NotificationsInbox } from "./inbox.js";
import { catchUpNotifications } from "./catch-up.js";

const PING_INTERVAL_MS = 30_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface WSMessageBase {
  type: string;
  [k: string]: unknown;
}

// Backend serializes via apiJson with JsonNamingStrategy.SnakeCase (see
// backend/src/.../Server.kt) — both REST AND WS frames carry snake_case
// keys, matching the rest of the MCP. The wire shape is identical to the
// internal Notification type; we cast directly after defensive shape
// validation.

export interface NotificationsWsClientOpts {
  client: LeadbayClient;
  inbox: NotificationsInbox;
  logger?: ToolLogger;
}

export class NotificationsWsClient {
  private readonly client: LeadbayClient;
  private readonly inbox: NotificationsInbox;
  private readonly logger?: ToolLogger;

  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private stopped = false;

  constructor(opts: NotificationsWsClientOpts) {
    this.client = opts.client;
    this.inbox = opts.inbox;
    this.logger = opts.logger;
  }

  async start(): Promise<void> {
    this.stopped = false;
    // Seed the inbox from REST before opening WS so the first tool call
    // already sees anything that completed while MCP was down.
    await catchUpNotifications(this.client, this.inbox, { logger: this.logger });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    if (this.ws) {
      try {
        this.ws.close(1000, "shutdown");
      } catch {
        // ignore — best-effort shutdown
      }
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let url: string;
    try {
      const ticket = await this.client.getWsTicket();
      url = ticket.url;
    } catch (err: any) {
      this.logger?.warn?.(
        `notifications.ws ticket_fetch_failed: ${err?.message ?? err?.code ?? err}`
      );
      this.scheduleReconnect();
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err: any) {
      this.logger?.warn?.(
        `notifications.ws construct_failed: ${err?.message ?? err}`
      );
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.logger?.info?.("notifications.ws connected");
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      // On every (re)connect: catch up via REST in case the gap dropped
      // any completion event. Idempotent — inbox dedupes by id.
      void catchUpNotifications(this.client, this.inbox, {
        logger: this.logger,
      });
      this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      const text =
        typeof ev.data === "string" ? ev.data : String(ev.data ?? "");
      if (!text) return;
      let msg: WSMessageBase;
      try {
        msg = JSON.parse(text);
      } catch {
        this.logger?.warn?.("notifications.ws non_json_frame");
        return;
      }
      this.handleMessage(msg);
    });

    ws.addEventListener("error", (ev: Event) => {
      // The `error` event provides little detail in the WebSocket spec.
      // The `close` event that follows carries the code/reason — handle
      // reconnect there.
      this.logger?.warn?.(
        `notifications.ws error: ${(ev as any)?.message ?? "(no detail)"}`
      );
    });

    ws.addEventListener("close", (ev: CloseEvent) => {
      this.logger?.info?.(
        `notifications.ws closed code=${ev.code} reason=${ev.reason || "(none)"}`
      );
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      this.scheduleReconnect();
    });
  }

  private handleMessage(msg: WSMessageBase): void {
    if (msg.type === "pong") return;
    if (msg.type === "ping") {
      // Spec is bidirectional ping — answer if we ever see one.
      this.sendRaw({ type: "pong" });
      return;
    }
    if (msg.type !== "notification") return;
    // The frame IS the NotificationPayload (with `type` keyed in by the
    // backend's pushMessage), so the same object is the payload — drop
    // the `type` field defensively before casting.
    const { type: _t, ...rest } = msg as any;
    void _t;
    const n = rest as Notification;
    if (n.bulk_progress == null || n.in_progress) {
      // Non-terminal frames are ignored — we only care about completions.
      return;
    }
    this.inbox.record(n);
    this.logger?.info?.(
      `notifications.ws terminal id=${n.id} kind=${
        n.file_import_id
          ? "import"
          : n.links.some((l) => l.type === "bulk_enrichment")
            ? "bulk_enrich"
            : "bulk_qualify"
      }`
    );
  }

  private sendPing(): void {
    this.sendRaw({ type: "ping" });
  }

  private sendRaw(obj: unknown): void {
    if (!this.ws) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (err: any) {
      this.logger?.warn?.(
        `notifications.ws send_failed: ${err?.message ?? err}`
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.logger?.info?.(`notifications.ws reconnect_in_${delay}ms`);
  }
}
