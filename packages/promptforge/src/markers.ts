// Surface markers — prose that exists on some MCP surfaces and not others.
//
//   {{tag}}
//   …
//   {{/tag}}
//
// A marker DELETES; it never substitutes. There is no second wording anywhere:
// the rendering without the blocks is the same text minus the marked spans,
// and the rendering with them is byte-for-byte what the template would produce
// with the marker lines removed.
//
// Two shapes:
//
//   Block — each marker alone on its line; the lines between them go together.
//   Inline — both markers inside one line. The span must carry its own leading
//     space INSIDE the markers, `resets{{tag}} (or top up){{/tag}}.`, so
//     deleting it leaves `resets.` and not a double space.
//
// Two tags use this today: `{{commerce}}` (commerce.ts) and `{{apps}}` (apps.ts).

export type MarkerMode = "with" | "without";

export interface SurfaceMarker {
  has(body: string): boolean;
  /** Reject unbalanced or nested pairs — both would leak a literal marker into
   *  a shipped description, the one failure nothing downstream catches. */
  validate(body: string): string | null;
  render(body: string, mode: MarkerMode): string;
}

export function surfaceMarker(tag: string): SurfaceMarker {
  const MARKER = new RegExp(`\\{\\{/?${tag}\\}\\}`, "g");
  // A marker alone on its line takes the line's newline with it, so the kept
  // block reads exactly as if the markers had never been written.
  //
  // `\r?\n`, not `\n`: a CRLF template left the \r behind, so the marker fell
  // through to the inline replace and the stripped line became a BLANK one. The
  // emitted description then carried a doubled blank line that a Linux build
  // does not produce — invisible until .gitattributes stopped the endings
  // themselves from drifting, and enough on its own to fail CI's
  // generated-files check.
  const OWN_LINE_MARKER = new RegExp(`\\{\\{/?${tag}\\}\\}\\r?\\n`, "g");
  // A deleted block takes its closing newline too.
  const BLOCK = new RegExp(`\\{\\{${tag}\\}\\}[\\s\\S]*?\\{\\{/${tag}\\}\\}\\r?\\n?`, "g");

  function has(body: string): boolean {
    // `MARKER` is a /g regex, and `.test` advances its `lastIndex` between
    // calls: a third call on a marked body returns FALSE, and `render` then
    // hands the body straight back with its markers intact. Reset before
    // testing rather than dropping the /g flag, which `.match` and `.replace`
    // below still need.
    MARKER.lastIndex = 0;
    return MARKER.test(body);
  }

  function validate(body: string): string | null {
    const open = (body.match(new RegExp(`\\{\\{${tag}\\}\\}`, "g")) ?? []).length;
    const close = (body.match(new RegExp(`\\{\\{/${tag}\\}\\}`, "g")) ?? []).length;
    if (open !== close) {
      return `unbalanced {{${tag}}} markers: ${open} opening, ${close} closing`;
    }
    for (const mode of ["with", "without"] as const) {
      const leaked = render(body, mode).match(MARKER);
      if (leaked) {
        return `{{${tag}}} markers survive the "${mode}" rendering (nested pairs?): ${leaked[0]}`;
      }
    }
    return null;
  }

  function render(body: string, mode: MarkerMode): string {
    if (!has(body)) return body;
    if (mode === "without") {
      return deleteBlocks(body);
    }
    // Keep the content, drop the markers — own-line pairs first so paragraph
    // spacing survives untouched, then whatever is left is inline.
    return body.replace(OWN_LINE_MARKER, "").replace(MARKER, "");
  }

  function deleteBlocks(body: string): string {
    const lines = body.split("\n");
    const out: string[] = [];
    let dropping = false;
    for (let i = 0; i < lines.length; i++) {
      const marker = lines[i].trim();
      if (dropping) {
        if (marker === `{{/${tag}}}`) {
          dropping = false;
          // The block stood alone between blank lines — take one of them, so
          // the paragraphs that survive end up one blank line apart, not two.
          // A "blank" line is "\r" on a CRLF template, so compare trimmed: an
          // exact "" test silently skips this on Windows and leaves the
          // doubled blank line the marker removal exists to prevent.
          const prev = out[out.length - 1];
          const next = lines[i + 1];
          if (prev !== undefined && prev.trim() === "" && next !== undefined && next.trim() === "") i++;
        }
        continue;
      }
      if (marker === `{{${tag}}}`) {
        dropping = true;
        continue;
      }
      out.push(lines[i].replace(BLOCK, ""));
    }
    return out.join("\n");
  }

  return { has, validate, render };
}
