/**
 * UpdateStateStore — atomic JSON persistence for the auto-update flow.
 *
 * Mirrors the bulk-store contract minimally for the fields the update
 * path actually mutates. The file-backed path is exercised against a
 * tmp directory so the symlink-rejection + 0600-mode behavior is the
 * same code path real users hit.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UpdateStateStore } from "../../src/update-state.js";

let tmpDir: string;
let path: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "leadbay-update-state-test-"));
  path = join(tmpDir, "update-state.json");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("UpdateStateStore — file backend", () => {
  it("returns empty state when the file does not exist", async () => {
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    const s = await store.read();
    expect(s).toEqual({ last_check_time: 0, suppressed_versions: [] });
  });

  it("round-trips state through write → read", async () => {
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    await store.write({
      last_check_time: 1_700_000_000_000,
      latest_known_version: "0.10.2",
      latest_known_mcpb_url: "https://example.com/leadbay-0.10.2.mcpb",
      latest_known_release_url: "https://example.com/releases/mcp-v0.10.2",
      etag: 'W/"abc"',
      suppressed_versions: ["0.10.1"],
      remind_until: 1_700_000_999_000,
      previous_running_version: "0.10.1",
    });
    const s = await store.read();
    expect(s.latest_known_version).toBe("0.10.2");
    expect(s.latest_known_mcpb_url).toBe("https://example.com/leadbay-0.10.2.mcpb");
    expect(s.etag).toBe('W/"abc"');
    expect(s.suppressed_versions).toEqual(["0.10.1"]);
    expect(s.remind_until).toBe(1_700_000_999_000);
    expect(s.previous_running_version).toBe("0.10.1");
  });

  it("writes the file with 0o600 mode", async () => {
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    await store.write({ last_check_time: 1, suppressed_versions: [] });
    const st = await stat(path);
    // POSIX permission bits — strip the file-type field.
    const perms = st.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it("update() composes partial mutations atomically", async () => {
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    await store.write({
      last_check_time: 1,
      suppressed_versions: ["0.10.0"],
      latest_known_version: "0.10.1",
    });
    const next = await store.update((cur) => ({
      ...cur,
      suppressed_versions: [...cur.suppressed_versions, "0.10.1"],
      remind_until: 999,
    }));
    expect(next.last_check_time).toBe(1);
    expect(next.latest_known_version).toBe("0.10.1");
    expect(next.suppressed_versions).toEqual(["0.10.0", "0.10.1"]);
    expect(next.remind_until).toBe(999);
  });

  it("rejects symlinks at the target path", async () => {
    // Create a real file the symlink will point at.
    const real = join(tmpDir, "real.json");
    await writeFile(real, "{}");
    await symlink(real, path);
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    await expect(store.read()).rejects.toThrow(/symlink/);
  });

  it("returns empty state when the file is corrupt JSON", async () => {
    await writeFile(path, "this is not json");
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    const s = await store.read();
    expect(s).toEqual({ last_check_time: 0, suppressed_versions: [] });
  });

  it("drops unknown fields + non-string entries in suppressed_versions", async () => {
    await writeFile(
      path,
      JSON.stringify({
        last_check_time: 5,
        suppressed_versions: ["0.1.0", 42, null, "0.2.0"],
        garbage_field: "ignored",
      })
    );
    const store = new UpdateStateStore({ backend: "file", path, allowUnsafePath: true });
    const s = await store.read();
    expect(s.last_check_time).toBe(5);
    expect(s.suppressed_versions).toEqual(["0.1.0", "0.2.0"]);
    expect((s as any).garbage_field).toBeUndefined();
  });

  it("rejects a path outside $HOME unless allowUnsafePath is set", () => {
    // tmpDir is /tmp/... — outside $HOME (unless HOME=/tmp, which we tolerate).
    const outsidePath = "/var/some/where/update-state.json";
    expect(
      () => new UpdateStateStore({ backend: "file", path: outsidePath })
    ).toThrow(/outside \$HOME/);
  });
});

describe("UpdateStateStore — memory backend", () => {
  it("round-trips without touching disk", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 1,
      suppressed_versions: ["x"],
    });
    const s = await store.read();
    expect(s.suppressed_versions).toEqual(["x"]);
    // Mutating the returned array must NOT bleed back into the store.
    s.suppressed_versions.push("y");
    const again = await store.read();
    expect(again.suppressed_versions).toEqual(["x"]);
  });
});
