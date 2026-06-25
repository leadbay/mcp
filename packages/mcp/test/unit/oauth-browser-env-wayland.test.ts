/**
 * Regression test for OAuth-on-install browser launch on Wayland + Snap/Flatpak
 * browsers (the common Ubuntu default).
 *
 * Root cause being guarded: Claude Desktop spawns the .dxt/.mcpb stdio server
 * with a sanitized env that strips XDG_RUNTIME_DIR, WAYLAND_DISPLAY, and
 * DBUS_SESSION_BUS_ADDRESS. Without them `xdg-open` spawns "successfully" but a
 * Snap browser can't reach the compositor / session bus, so no tab opens and
 * the OAuth page never appears. `browserLaunchEnv()` must reconstruct these
 * from /run/user/<uid> so the launch actually reaches the browser.
 *
 * Confirmed live on a Wayland + Snap-firefox machine: with the reconstructed
 * env, the tab opens; without it, silent no-op.
 *
 * New file (existing oauth-browser-open.test.ts is left untouched).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { browserLaunchEnv } from "../../src/oauth.js";

const isLinux = process.platform === "linux";
const uid = process.getuid?.();
const runtimeDir = uid !== undefined ? `/run/user/${uid}` : undefined;
const hasRuntimeDir = !!runtimeDir && existsSync(runtimeDir);

describe("browserLaunchEnv — Wayland/DBus reconstruction", () => {
  const saved = {
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    DISPLAY: process.env.DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY,
  };

  beforeEach(() => {
    // Simulate Claude Desktop's stripped child env.
    delete process.env.XDG_RUNTIME_DIR;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
    delete process.env.DISPLAY;
    delete process.env.XAUTHORITY;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("non-linux: returns env untouched", () => {
    if (isLinux) return; // only meaningful off-linux
    const env = browserLaunchEnv();
    expect(env.XDG_RUNTIME_DIR).toBeUndefined();
  });

  it("linux: always sets a DISPLAY fallback even with nothing in env", () => {
    if (!isLinux) return;
    const env = browserLaunchEnv();
    // DISPLAY is reconstructed unconditionally (":0" worst case).
    expect(env.DISPLAY).toBeTruthy();
  });

  it("linux + real runtime dir: reconstructs XDG_RUNTIME_DIR, and DBUS when the bus socket exists", () => {
    if (!isLinux || !hasRuntimeDir) return; // skip on headless CI without /run/user/<uid>
    const env = browserLaunchEnv();
    expect(env.XDG_RUNTIME_DIR).toBe(runtimeDir);
    // The bus socket is the standard Snap/Flatpak handoff path; when present it
    // must be wired so xdg-open can reach a running browser instance.
    if (existsSync(`${runtimeDir}/bus`)) {
      expect(env.DBUS_SESSION_BUS_ADDRESS).toBe(`unix:path=${runtimeDir}/bus`);
    }
    // X11/XWayland browsers need the X authority cookie or they can't connect to
    // the display. Under Mutter/Wayland it lives at <runtimeDir>/.mutter-Xwaylandauth.*
    const cookie = readdirSync(runtimeDir!).find((f) => /^\.mutter-Xwaylandauth\./.test(f));
    if (cookie) {
      expect(env.XAUTHORITY).toBe(`${runtimeDir}/${cookie}`);
    }
  });

  it("does not override values already present in env (when the runtime dir exists)", () => {
    if (!isLinux || !hasRuntimeDir) return;
    // A real, existing runtime dir is kept as-is (the override only kicks in
    // when XDG_RUNTIME_DIR is missing or points at a non-existent path).
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/already/set";
    process.env.WAYLAND_DISPLAY = "wayland-9";
    process.env.DISPLAY = ":7";
    process.env.XAUTHORITY = "/already/.Xauthority";
    const env = browserLaunchEnv();
    expect(env.XDG_RUNTIME_DIR).toBe(runtimeDir);
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/already/set");
    expect(env.WAYLAND_DISPLAY).toBe("wayland-9");
    expect(env.DISPLAY).toBe(":7");
    expect(env.XAUTHORITY).toBe("/already/.Xauthority");
  });
});
