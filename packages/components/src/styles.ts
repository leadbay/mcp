// @leadbay/components — the optional artifact skin.
//
// Ported from the frontend design system (frontend/packages/style/) so an
// artifact looks like the Leadbay product rather than a generic page. Four
// conventions were taken verbatim from there:
//
//   1. COLOR TOKENS. Every value is a `--color-*` custom property lifted from
//      packages/style/color.css — the same gray-1..gray-9 ramp and the same
//      semantic background/foreground pairs (green/red/gold/blue). The style
//      package's rule is "use the tokens, never a hardcoded color", so the skin
//      declares them once and every rule reads through them.
//   2. COMPONENT-LOCAL ALIASES. Toast.module.css sets `--toast-surface`,
//      `--toast-border`, … on the component root and themes by overriding those,
//      not by rewriting rules. `.lb-card` does the same with `--lb-surface` etc.
//   3. corner-shape: squircle + 1rem / 0.625rem radii, matching Toast.
//   4. `data-theme="dark"` as the dark hook. Toast themes that way; we ALSO
//      honour prefers-color-scheme, because an artifact renders inside a host
//      whose theme we cannot set an attribute for.
//
// The library still renders NO markup — this is opt-in (`lb.styles()`), scoped
// entirely under `lb-*`, and never touches the agent's own class attributes.
//
// Font: the product face is "Nikkei Maru" (packages/style/font.css), loaded from
// @leadbay/assets. An artifact is a single inlined file on an unknown origin and
// cannot reach that package, so the stack names it first and degrades to the
// system UI face. Do NOT add an @font-face pointing at a CDN — artifacts are
// inline-only.

export const STYLES = `
:root{
--color-black:#191919;--color-white:#fff;
--color-gray-1:#f9f9f9;--color-gray-2:#f0f0f0;--color-gray-3:#e0e0e0;--color-gray-4:#cecece;
--color-gray-5:#c4c4c4;--color-gray-6:#8d8d8d;--color-gray-7:#787878;--color-gray-8:#646464;
--color-gray-9:#202020;
--color-linkedin:#0a66c2;
--color-blue-background:oklch(0.947 0.029 251);--color-blue-foreground:oklch(0.564 0.181 251);
--color-green-background:oklch(0.947 0.029 141);--color-green-foreground:oklch(0.564 0.181 141);
--color-red-background:oklch(0.947 0.029 26);--color-red-foreground:oklch(0.564 0.191 26);
--color-gold-background:oklch(0.972 0.049 91);--color-gold-foreground:oklch(0.667 0.177 91);
--color-cherry-background:oklch(0.947 0.029 15);--color-cherry-foreground:oklch(0.44 0.146 15);
--color-red-like:var(--color-cherry-foreground);
--lb-font:"Nikkei Maru",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--lb-radius:1rem;--lb-radius-sm:0.625rem;--lb-gap:0.75rem;
--lb-surface:var(--color-gray-1);--lb-border:var(--color-gray-3);
--lb-fg:var(--color-black);--lb-muted:var(--color-gray-8);--lb-field:var(--color-white);
}
:root[data-theme=dark],:root[data-lb-theme=dark]{
--lb-surface:var(--color-gray-9);--lb-border:var(--color-gray-8);
--lb-fg:var(--color-white);--lb-muted:var(--color-gray-3);--lb-field:var(--color-gray-9);
}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]):not([data-lb-theme=light]){
--lb-surface:var(--color-gray-9);--lb-border:var(--color-gray-8);
--lb-fg:var(--color-white);--lb-muted:var(--color-gray-3);--lb-field:var(--color-gray-9);
}}
.lb-card{display:grid;gap:var(--lb-gap);padding:0.875rem;
background-color:var(--lb-surface);border:1px solid var(--lb-border);
border-radius:var(--lb-radius);corner-shape:squircle;color:var(--lb-fg);
font-family:var(--lb-font);
box-shadow:0 1rem 2.5rem color-mix(in srgb,var(--color-gray-9) 6%,transparent),
0 0.125rem 0.5rem color-mix(in srgb,var(--color-gray-9) 4%,transparent)}
.lb-card-head{display:flex;justify-content:space-between;align-items:baseline;gap:var(--lb-gap)}
.lb-title{font-size:0.875rem;font-weight:600;line-height:1.25rem;color:var(--lb-fg)}
.lb-sub{font-size:0.8125rem;line-height:1.125rem;color:var(--lb-muted)}
.lb-row{display:flex;align-items:center;gap:var(--lb-gap);flex-wrap:wrap}
.lb-stack{display:grid;gap:var(--lb-gap)}
.lb-select,.lb-input{font:inherit;font-family:var(--lb-font);font-size:0.8125rem;color:var(--lb-fg);
background-color:var(--lb-field);border:1px solid var(--lb-border);
border-radius:var(--lb-radius-sm);corner-shape:squircle;padding:0.4rem 0.55rem;min-height:2.125rem}
.lb-btn{font:inherit;font-family:var(--lb-font);font-size:0.8125rem;font-weight:600;
color:var(--lb-fg);background-color:var(--lb-field);border:1px solid var(--lb-border);
border-radius:var(--lb-radius-sm);corner-shape:squircle;padding:0.4rem 0.85rem;min-height:2.125rem;
cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}
.lb-btn:hover:not([disabled]){border-color:var(--color-gray-6)}
.lb-btn:focus-visible,.lb-select:focus-visible,.lb-input:focus-visible{
outline:2px solid var(--color-blue-foreground);outline-offset:1px}
.lb-btn[data-lb-state=loading]{opacity:.55;cursor:progress}
.lb-btn[data-lb-state=success]{background-color:var(--color-green-background);
border-color:var(--color-green-foreground);color:var(--color-green-foreground)}
.lb-btn[data-lb-state=error],.lb-select[data-lb-state=error]{
background-color:var(--color-red-background);border-color:var(--color-red-foreground);
color:var(--color-red-foreground)}
.lb-btn[data-lb-state=unavailable],.lb-btn[disabled]{opacity:.5;cursor:not-allowed}
.lb-msg{font-size:0.8125rem;line-height:1.125rem;color:var(--lb-muted)}
.lb-msg[data-tone=error]{color:var(--color-red-foreground)}
.lb-msg[data-tone=ok]{color:var(--color-green-foreground)}
.lb-chip{display:inline-flex;align-items:center;gap:.25rem;white-space:nowrap;
font-size:0.75rem;font-weight:600;line-height:1rem;padding:0.125rem 0.5rem;
border-radius:var(--lb-radius-sm);corner-shape:squircle;
background-color:var(--color-gray-2);color:var(--lb-muted)}
.lb-chip[data-status=WANTED]{background-color:var(--color-blue-background);color:var(--color-blue-foreground)}
.lb-chip[data-status=WON]{background-color:var(--color-green-background);color:var(--color-green-foreground)}
.lb-chip[data-status=LOST]{background-color:var(--color-red-background);color:var(--color-red-foreground)}
.lb-chip[data-status=UNWANTED]{background-color:var(--color-gray-2);color:var(--color-gray-7)}
.lb-chip[data-taste=liked]{background-color:var(--color-cherry-background);color:var(--color-red-like)}
.lb-chip[data-taste=disliked]{background-color:var(--color-gray-2);color:var(--color-gray-7)}
.lb-chips{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.lb-chip[hidden]{display:none}
.lb-table{width:100%;border-collapse:collapse;font-family:var(--lb-font);color:var(--lb-fg)}
.lb-table th,.lb-table td{text-align:left;padding:0.5rem 0.4rem;
border-bottom:1px solid var(--lb-border);vertical-align:middle;font-size:0.8125rem}
.lb-table th{font-size:0.75rem;font-weight:600;color:var(--lb-muted);
text-transform:uppercase;letter-spacing:.04em}
.lb-link{color:var(--color-blue-foreground);text-decoration:none}
.lb-link:hover{text-decoration:underline}
.lb-spinner{display:inline-block;width:.7em;height:.7em;border:2px solid var(--lb-border);
border-top-color:var(--color-blue-foreground);border-radius:50%;animation:lb-spin .8s linear infinite}
@keyframes lb-spin{to{transform:rotate(1turn)}}
@media(prefers-reduced-motion:reduce){.lb-spinner{animation:none}
.lb-btn{transition-property:none}}
`;

/** id on the injected <style> — also the idempotency key. */
export const STYLE_ELEMENT_ID = "lb-styles";
