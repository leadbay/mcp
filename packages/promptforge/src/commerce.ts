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
// Block and inline shapes, and the rules for each: see markers.ts.

import { surfaceMarker, type MarkerMode } from "./markers.js";

export type CommerceMode = MarkerMode;

const commerce = surfaceMarker("commerce");

export function hasCommerceMarkers(body: string): boolean {
  return commerce.has(body);
}

/**
 * Reject a template whose markers do not pair up or that nests one pair inside
 * another. Both would leak a literal `{{commerce}}` into a shipped description,
 * which is the one failure mode nothing downstream catches.
 */
export function validateCommerceMarkers(body: string): string | null {
  return commerce.validate(body);
}

export function renderCommerce(body: string, mode: CommerceMode): string {
  return commerce.render(body, mode);
}
