import { describe, it, expect } from "vitest";
import { pageHtml, pageUninstallHtml } from "../../installer/installer-gui.js";

// Extracts the JSON injected as `const T = {...};` into the inline page script,
// so we can assert the client script will read the localized dictionary.
function extractInjectedDict(html: string): any {
  const match = html.match(/const T = (\{.*?\});\n/s);
  if (!match) throw new Error("injected `const T = {...}` blob not found in page");
  return JSON.parse(match[1]);
}

describe("installer GUI localization — installer page", () => {
  it("no-arg defaults to English (backward compatible)", () => {
    const html = pageHtml();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Connect Leadbay");
    expect(html).toContain("Sign in with Leadbay");
  });

  it('pageHtml("en") renders English', () => {
    const html = pageHtml("en");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Connect Leadbay");
  });

  it('pageHtml("fr") renders French in static HTML and lang attribute', () => {
    const html = pageHtml("fr");
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Connectez Leadbay");
    expect(html).toContain("Se connecter avec Leadbay");
    expect(html).not.toContain("Connect Leadbay");
  });

  it('pageHtml("fr") injects a French string dictionary the client script reads', () => {
    const html = pageHtml("fr");
    expect(html).toContain('const LOCALE = "fr";');
    const dict = extractInjectedDict(html);
    expect(dict.steps["1"].title).toBe("Connectez Leadbay");
    expect(dict.btnInstall).toBe("Installer");
    expect(dict.successInstalled).toBe("MCP installé avec succès");
  });
});

describe("installer GUI localization — uninstaller page", () => {
  it("no-arg defaults to English (backward compatible)", () => {
    const html = pageUninstallHtml();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Remove Leadbay MCP");
  });

  it('pageUninstallHtml("fr") renders French', () => {
    const html = pageUninstallHtml("fr");
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Supprimer Leadbay MCP");
    expect(html).toContain("Supprimer la sélection");
    expect(html).toContain('const LOCALE = "fr";');
    const dict = extractInjectedDict(html);
    expect(dict.successRemoved).toBe("MCP supprimé avec succès");
  });
});
