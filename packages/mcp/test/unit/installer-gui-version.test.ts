import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pageHtml, pageUninstallHtml } from "../../installer/installer-gui.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("installer GUI version label", () => {
  it("installer page renders the package version in a grey footer", () => {
    const html = pageHtml();
    expect(html).toContain(`<p class="version">v${pkg.version}</p>`);
    expect(html).toContain(".version { text-align:center; color:var(--muted);");
  });

  it("uninstaller page renders the package version in a grey footer", () => {
    const html = pageUninstallHtml();
    expect(html).toContain(`<p class="version">v${pkg.version}</p>`);
    expect(html).toContain(".version { text-align:center; color:var(--muted);");
  });
});
