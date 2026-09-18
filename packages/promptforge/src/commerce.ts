// `{{commerce}}` — mark prose that only exists where selling is allowed.
//
// The OpenAI app directory forbids promoting upgrades or linking to a checkout;
// Anthropic's directory has no such rule. So a handful of paragraphs must be
// present on the Claude surface and absent on the ChatGPT one.
//
//   {{commerce}}
//   **Top-ups always beat waiting.** …
//   {{/commerce}}
//
// This marker DELETES; it never substitutes. There is no second, softened
// wording anywhere — the commerce-free rendering is the same text minus the
// marked blocks, and the default rendering is byte-for-byte what the template
// would produce with the marker lines removed. Claude's prompts keep selling
// exactly as hard as they do today.
//
// Two shapes:
//
//   Block — each marker alone on its line; the lines between them go together.
//   Inline — both markers inside one line. The span must carry its own leading
//     space INSIDE the markers, `resets{{commerce}} (or top up){{/commerce}}.`,
//     so deleting it leaves `resets.` and not a double space.

export type CommerceMode = "with" | "without";

const TAG = "commerce";
const MARKER = new RegExp(`\\{\\{/?${TAG}\\}\\}`, "g");
// A marker alone on its line takes the line's newline with it, so the kept
// block reads exactly as if the markers had never been written.
//
// `\r?\n`, not `\n`: a CRLF template left the \r behind, so the marker fell
// through to the inline replace and the stripped line became a BLANK one. The
// emitted description then carried a doubled blank line that a Linux build does
// not produce — invisible until .gitattributes stopped the endings themselves
// from drifting, and enough on its own to fail CI's generated-files check.
const OWN_LINE_MARKER = new RegExp(`\\{\\{/?${TAG}\\}\\}\\r?\\n`, "g");
// A deleted block takes its closing newline too.
const BLOCK = new RegExp(`\\{\\{${TAG}\\}\\}[\\s\\S]*?\\{\\{/${TAG}\\}\\}\\r?\\n?`, "g");

export function hasCommerceMarkers(body: string): boolean {
  // `MARKER` is a module-level /g regex, and `.test` advances its `lastIndex`
  // between calls: a third call on a marked body returns FALSE, and
  // `renderCommerce` then hands the body straight back with its markers intact.
  // Reset before testing rather than dropping the /g flag, which `.match` and
  // `.replace` below still need.
  MARKER.lastIndex = 0;
  return MARKER.test(body);
}

/**
 * Reject a template whose markers do not pair up or that nests one pair inside
 * another. Both would leak a literal `{{commerce}}` into a shipped description,
 * which is the one failure mode nothing downstream catches.
 */
export function validateCommerceMarkers(body: string): string | null {
  const open = (body.match(new RegExp(`\\{\\{${TAG}\\}\\}`, "g")) ?? []).length;
  const close = (body.match(new RegExp(`\\{\\{/${TAG}\\}\\}`, "g")) ?? []).length;
  if (open !== close) {
    return `unbalanced {{${TAG}}} markers: ${open} opening, ${close} closing`;
  }
  for (const mode of ["with", "without"] as const) {
    const leaked = renderCommerce(body, mode).match(MARKER);
    if (leaked) {
      return `{{${TAG}}} markers survive the "${mode}" rendering (nested pairs?): ${leaked[0]}`;
    }
  }
  return null;
}

export function renderCommerce(body: string, mode: CommerceMode): string {
  if (!hasCommerceMarkers(body)) return body;
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
      if (marker === `{{/${TAG}}}`) {
        dropping = false;
        // The block stood alone between blank lines — take one of them, so the
        // paragraphs that survive end up one blank line apart, not two.
        // A "blank" line is "\r" on a CRLF template, so compare trimmed: an
        // exact "" test silently skips this on Windows and leaves the doubled
        // blank line the marker removal exists to prevent.
        const prev = out[out.length - 1];
        const next = lines[i + 1];
        if (prev !== undefined && prev.trim() === "" && next !== undefined && next.trim() === "") i++;
      }
      continue;
    }
    if (marker === `{{${TAG}}}`) {
      dropping = true;
      continue;
    }
    out.push(lines[i].replace(BLOCK, ""));
  }
  return out.join("\n");
}
