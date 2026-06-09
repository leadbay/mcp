/**
 * Unit tests for NotificationsInbox + revise-hint.
 *
 * Covers:
 *   - record() ignores non-bulk / still-in-progress frames.
 *   - record() upserts by id (latest wins; duplicates collapse).
 *   - list() expires entries past TTL.
 *   - inferKind() maps anchor FKs to the canonical bulk-kind enum.
 *   - reviseHintFor() returns the user-facing one-sentence guidance per kind.
 */

import { describe, it, expect } from "vitest";
import { NotificationsInbox, inferKind, reviseHintFor } from "../../../src/notifications/index.js";
import type { Notification } from "../../../src/types.js";

function mkNotification(over: Partial<Notification>): Notification {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    created_at: "2026-05-26T00:00:00Z",
    updated_at: "2026-05-26T00:01:00Z",
    first_seen_at: null,
    archived: false,
    language: "en",
    title: "Enrichment done",
    content: null,
    in_progress: false,
    links: [],
    bulk_progress: {
      total_count: 10,
      success_count: 8,
      failure_count: 1,
      quota_hit_count: 1,
    },
    file_import_id: null,
    ...over,
  };
}

describe("NotificationsInbox", () => {
  it("ignores notifications without bulk_progress", () => {
    const inbox = new NotificationsInbox();
    inbox.record(mkNotification({ bulk_progress: null }));
    expect(inbox.list()).toEqual([]);
  });

  it("ignores in-progress notifications", () => {
    const inbox = new NotificationsInbox();
    inbox.record(mkNotification({ in_progress: true }));
    expect(inbox.list()).toEqual([]);
  });

  it("records terminal bulk-progress notifications and surfaces the revise_hint", () => {
    const inbox = new NotificationsInbox();
    inbox.record(
      mkNotification({
        links: [{ type: "bulk_enrichment", id: "42" }],
      })
    );
    const entries = inbox.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      notification_id: "00000000-0000-4000-8000-000000000001",
      kind: "bulk_enrich",
      anchor_id: "42",
      title: "Enrichment done",
      bulk_progress: {
        total_count: 10,
        success_count: 8,
        failure_count: 1,
        quota_hit_count: 1,
      },
    });
    expect(entries[0].revise_hint).toMatch(/contact enrichment/i);
  });

  it("upserts by id when the same notification arrives twice (WS + REST catch-up)", () => {
    const inbox = new NotificationsInbox();
    inbox.record(mkNotification({ title: "first" }));
    inbox.record(mkNotification({ title: "second" }));
    const entries = inbox.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("second");
  });

  it("markSeen drops the entry", () => {
    const inbox = new NotificationsInbox();
    inbox.record(mkNotification({}));
    inbox.markSeen("00000000-0000-4000-8000-000000000001");
    expect(inbox.list()).toEqual([]);
  });

  it("expires entries older than ttl_ms on list()", () => {
    let now = 1_000_000_000_000;
    const inbox = new NotificationsInbox({ ttl_ms: 1000, now: () => now });
    inbox.record(mkNotification({}));
    expect(inbox.list()).toHaveLength(1);
    now += 2000;
    expect(inbox.list()).toEqual([]);
  });
});

describe("inferKind", () => {
  it("maps bulk_enrichment link to bulk_enrich", () => {
    const n = mkNotification({ links: [{ type: "bulk_enrichment", id: "42" }] });
    expect(inferKind(n)).toBe("bulk_enrich");
  });

  it("maps file_import_id to import", () => {
    const n = mkNotification({
      file_import_id: "fi-1",
      links: [],
    });
    expect(inferKind(n)).toBe("import");
  });

  it("maps counters-only to bulk_qualify", () => {
    const n = mkNotification({ links: [], file_import_id: null });
    expect(inferKind(n)).toBe("bulk_qualify");
  });

  it("returns 'other' when no bulk_progress AND no anchor", () => {
    const n = mkNotification({
      bulk_progress: null,
      links: [],
      file_import_id: null,
    });
    expect(inferKind(n)).toBe("other");
  });
});

describe("reviseHintFor", () => {
  it("bulk_enrich hint mentions contact enrichment + outreach drafts", () => {
    const h = reviseHintFor("bulk_enrich");
    expect(h).toMatch(/contact enrichment/i);
    expect(h).toMatch(/outreach drafts/i);
  });

  it("bulk_qualify hint mentions ai_agent_lead_score", () => {
    const h = reviseHintFor("bulk_qualify");
    expect(h).toMatch(/qualification/i);
  });

  it("import hint mentions lens / leads available", () => {
    const h = reviseHintFor("import");
    expect(h).toMatch(/import/i);
    expect(h).toMatch(/lens|leads available/i);
  });
});
