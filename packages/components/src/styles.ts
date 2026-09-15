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
/* Concentric: outer = inner + padding (0.625 + 0.875 = 1.5rem). At 1rem the
   inner control's arc outran the card's in the corner. */
--lb-radius:1.5rem;--lb-radius-sm:0.625rem;--lb-gap:0.75rem;
--lb-surface:var(--color-gray-1);--lb-border:var(--color-gray-3);
--lb-fg:var(--color-black);--lb-muted:var(--color-gray-8);--lb-field:var(--color-white);
/* Chips and shadows need their own aliases: a chip painted with a raw ramp
   value cannot theme, and a shadow tinted with --color-gray-9 is invisible in
   dark because gray-9 IS the dark surface. */
--lb-chip-bg:var(--color-gray-2);
--lb-control-border:var(--color-gray-6);
--lb-shadow:0 0.5rem 1.5rem oklch(0 0 0/.06),0 0.125rem 0.5rem oklch(0 0 0/.04);
color-scheme:light;
}
:root[data-theme=dark],:root[data-lb-theme=dark]{
--lb-surface:var(--color-gray-9);--lb-border:var(--color-gray-8);
--lb-fg:var(--color-white);--lb-muted:var(--color-gray-3);
/* --lb-field must NOT equal --lb-surface: a control needs its own ground or it
   reads as text on the card (was 1.00:1). */
--lb-field:#2c2c2c;
--lb-chip-bg:#3b3b3b;
--lb-control-border:var(--color-gray-6);
--lb-shadow:0 0.5rem 1.5rem oklch(0 0 0/.5),0 0.125rem 0.5rem oklch(0 0 0/.35);
color-scheme:dark;
--color-blue-background:oklch(0.30 0.055 251);--color-blue-foreground:oklch(0.80 0.11 251);
--color-green-background:oklch(0.30 0.055 141);--color-green-foreground:oklch(0.80 0.13 141);
--color-red-background:oklch(0.30 0.060 26);--color-red-foreground:oklch(0.80 0.11 26);
--color-gold-background:oklch(0.30 0.055 91);--color-gold-foreground:oklch(0.82 0.13 91);
--color-cherry-background:oklch(0.30 0.055 15);--color-cherry-foreground:oklch(0.82 0.10 15);
}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]):not([data-lb-theme=light]){
--lb-surface:var(--color-gray-9);--lb-border:var(--color-gray-8);
--lb-fg:var(--color-white);--lb-muted:var(--color-gray-3);
/* --lb-field must NOT equal --lb-surface: a control needs its own ground or it
   reads as text on the card (was 1.00:1). */
--lb-field:#2c2c2c;
--lb-chip-bg:#3b3b3b;
--lb-control-border:var(--color-gray-6);
--lb-shadow:0 0.5rem 1.5rem oklch(0 0 0/.5),0 0.125rem 0.5rem oklch(0 0 0/.35);
color-scheme:dark;
--color-blue-background:oklch(0.30 0.055 251);--color-blue-foreground:oklch(0.80 0.11 251);
--color-green-background:oklch(0.30 0.055 141);--color-green-foreground:oklch(0.80 0.13 141);
--color-red-background:oklch(0.30 0.060 26);--color-red-foreground:oklch(0.80 0.11 26);
--color-gold-background:oklch(0.30 0.055 91);--color-gold-foreground:oklch(0.82 0.13 91);
--color-cherry-background:oklch(0.30 0.055 15);--color-cherry-foreground:oklch(0.82 0.10 15);
}}
.lb-card{display:grid;gap:var(--lb-gap);padding:0.875rem;
background-color:var(--lb-surface);border:1px solid var(--lb-border);
border-radius:var(--lb-radius);corner-shape:squircle;color:var(--lb-fg);
font-family:var(--lb-font);
box-shadow:var(--lb-shadow)}
/* The head must be able to wrap. Both children default to flex:0 1 auto, so
   without this they shrink together and a long company name is crushed to three
   lines while the chips keep full width. flex-basis:11rem is a content breakpoint:
   below ~176px for the title, the chips drop to their own line instead. */
.lb-card-head{display:flex;flex-wrap:wrap;justify-content:space-between;
align-items:baseline;gap:var(--lb-gap)}
/* An email or URL has no break opportunity — browsers do not break at "@" or
   ".", so without this a company address escapes the card and the chat host
   clips it with no way to recover the tail. */
.lb-title{font-size:0.875rem;font-weight:600;line-height:1.3;color:var(--lb-fg);
overflow-wrap:break-word;min-width:0;flex:1 1 11rem}
.lb-sub{font-size:0.8125rem;line-height:1.45;color:var(--lb-muted);
overflow-wrap:break-word;max-width:68ch}
/* An empty fact line is a 30px void that reads as a rendering bug. */
.lb-sub:empty{display:none}
/* Every card child shared one 12px gap, so nothing grouped: the switchboard
   number, the contact and the fit judgement read as one paragraph. 4px inside
   the facts vs 12px to the why line is a 3x ratio — grouping by space, with no
   rule or border. */
.lb-facts{display:grid;gap:0.25rem}
/* The contract's canonical skeleton already emits data-why; the sheet just did
   not honour it, so consumers hand-patched an inline font-style. */
.lb-sub[data-why]{font-style:italic;color:var(--lb-fg)}
/* Icon column: the glyph gets its own cell so a wrapping line hangs on one
   shared text edge instead of running back under the emoji. */
.lb-fact{display:grid;grid-template-columns:1.15rem 1fr;gap:0.35rem;align-items:baseline}
.lb-row{display:flex;align-items:center;gap:var(--lb-gap);flex-wrap:wrap}
/* row-gap matters once the row wraps: without it the wrapped line sits flush
   against the one above. */
.lb-row{row-gap:0.5rem}
.lb-stack{display:grid;gap:var(--lb-gap)}
.lb-select,.lb-input{font:inherit;font-family:var(--lb-font);font-size:0.8125rem;color:var(--lb-fg);
background-color:var(--lb-field);border:1px solid var(--lb-control-border);
border-radius:var(--lb-radius-sm);corner-shape:squircle;padding:0.4rem 0.55rem;min-height:2.125rem}
.lb-btn{font:inherit;font-family:var(--lb-font);font-size:0.8125rem;font-weight:600;
color:var(--lb-fg);background-color:var(--lb-field);border:1px solid var(--lb-control-border);
border-radius:var(--lb-radius-sm);corner-shape:squircle;padding:0.4rem 0.85rem;min-height:2.125rem;
cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}
.lb-btn:hover:not([disabled]){border-color:var(--color-gray-7)}
/* A SUBMIT is not a toggle. Like/Dislike are independent switches; "Set status"
   commits the value sitting in the select beside it. Rendered identically, the
   row reads as five peers and the rep cannot see which control ends the task.
   The accent border + tinted ground marks it as the commit without making it a
   loud filled button — the state styles above still win when they apply. */
/* INVERTED, not recoloured. A normal button is --lb-fg on --lb-field; the
   submit swaps them. That introduces no new hue, and it themes for free: light
   gives near-black on white, dark gives white on near-black — the polarity flip
   reads as "this one commits" in both, without competing with the semantic
   state colours (success green / error red) that still override it. */
.lb-btn-submit{background-color:var(--lb-fg);color:var(--lb-field);
border-color:var(--lb-fg)}
.lb-btn-submit:hover:not([disabled]){
background-color:color-mix(in srgb,var(--lb-fg) 85%,var(--lb-field));
border-color:var(--lb-fg)}
/* Toggles that act on the same axis belong in one visual unit, so the row reads
   as "taste | status | inspect" rather than five equal buttons. The gap inside
   a group is half the gap between groups — the 2x rule, applied horizontally. */
.lb-group{display:inline-flex;align-items:center;gap:0.375rem;flex-wrap:wrap}
/* Square icon button. Only for actions whose glyph is unambiguous on its own —
   thumbs up/down qualify, "Set status" does not. It MUST carry an aria-label
   and a title: with no text the icon is the entire affordance, so an unlabelled
   one is unreadable to a screen reader and to anyone who does not know the
   glyph. Same 2.125rem box as a text button, so it keeps the row's baseline. */
.lb-btn-icon{padding:0;width:2.125rem;justify-content:center;display:inline-flex;
align-items:center}
.lb-btn-icon svg{width:1.05rem;height:1.05rem;flex-shrink:0}
/* Pressed state. The taste chip carries the durable fact; this is the control
   reflecting it, and it must not rely on colour alone — aria-pressed is the
   accessible half and the fill is the visible half. */
/* A heart that stays hollow does not read as "liked" — fill it from the same
   currentColor the stroke uses, so one rule covers both themes. */
.lb-btn-icon[aria-pressed=true] svg{fill:currentColor}
.lb-btn-icon[aria-pressed=true]{border-color:var(--color-red-like);
color:var(--color-red-like);
background-color:color-mix(in srgb,var(--color-red-like) 10%,var(--lb-field))}
.lb-btn-icon[data-taste=disliked][aria-pressed=true]{border-color:var(--lb-muted);
color:var(--lb-muted);
background-color:color-mix(in srgb,var(--lb-muted) 10%,var(--lb-field))}
/* A glyph-only control has no text to widen its hit area, so extend the target
   past the 34px box without inflating the row. */
.lb-btn-icon{position:relative}
.lb-btn-icon::before{content:"";position:absolute;inset:-5px}
.lb-btn:focus-visible,.lb-select:focus-visible,.lb-input:focus-visible,
.lb-link:focus-visible{
outline:2px solid var(--color-blue-foreground);outline-offset:1px;
border-radius:var(--lb-radius-sm)}
/* Forced colours replaces every background and custom outline with a system
   colour, collapsing the state styling above into one flat control. */
@media(forced-colors:active){
.lb-btn,.lb-select,.lb-input,.lb-chip{border:1px solid CanvasText}
.lb-btn:focus-visible,.lb-select:focus-visible,.lb-input:focus-visible,
.lb-link:focus-visible,.lb-link-out:focus-visible{outline:2px solid Highlight}
.lb-link-out{opacity:1}}
/* Each state carries a glyph as well as a hue: success and error were two
   pills with identical labels, indistinguishable to a red-green colour-blind
   reader and identical under forced colours. */
.lb-btn[data-lb-state=loading]{opacity:.55;cursor:progress}
.lb-btn[data-lb-state=loading]::after{content:"…";margin-inline-start:.35rem}
/* An icon button has no room for a trailing glyph — it would push the icon
   off-centre. Its states read through border and fill, which the forced-colors
   block below keeps distinguishable. */
.lb-btn-icon::after{content:none!important}
.lb-btn[data-lb-state=success]::after{content:"✓";margin-inline-start:.35rem}
.lb-btn[data-lb-state=error]::after{content:"✕";margin-inline-start:.35rem}
.lb-btn[data-lb-state=unavailable]::after{content:"⚠";margin-inline-start:.35rem}
/* With save-on-change there is no button to reflect the write, so the select
   itself must. Only error was styled before; loading and success were invisible
   on a select, leaving the rep unsure whether the pick had landed. */
.lb-select[data-lb-state=loading]{opacity:.55;cursor:progress}
.lb-select[data-lb-state=success]{border-color:var(--color-green-foreground)}
.lb-msg[data-tone=error]::before{content:"✕ "}
.lb-msg[data-tone=ok]::before{content:"✓ "}
.lb-btn[data-lb-state=success]{background-color:var(--color-green-background);
border-color:var(--color-green-foreground);color:var(--color-green-foreground)}
.lb-btn[data-lb-state=error],.lb-select[data-lb-state=error]{
background-color:var(--color-red-background);border-color:var(--color-red-foreground);
color:var(--color-red-foreground)}
.lb-btn[data-lb-state=unavailable],.lb-btn[disabled]{opacity:.5;cursor:not-allowed}
.lb-msg{font-size:0.8125rem;line-height:1.45;color:var(--lb-muted)}
/* Screen-reader-only text: control labels, unit suffixes, "opens in a new tab". */
.lb-vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;
overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.lb-msg[data-tone=error]{color:var(--color-red-foreground)}
.lb-msg[data-tone=ok]{color:var(--color-green-foreground)}
.lb-chip{display:inline-flex;align-items:center;gap:.25rem;white-space:nowrap;
font-size:0.75rem;font-weight:600;line-height:1rem;padding:0.125rem 0.5rem;
border-radius:var(--lb-radius-sm);corner-shape:squircle;
background-color:var(--lb-chip-bg);color:var(--lb-muted)}
.lb-chip[data-status=WANTED]{background-color:var(--color-blue-background);color:var(--color-blue-foreground)}
.lb-chip[data-status=WON]{background-color:var(--color-green-background);color:var(--color-green-foreground)}
.lb-chip[data-status=LOST]{background-color:var(--color-red-background);color:var(--color-red-foreground)}
.lb-chip[data-status=UNWANTED]{background-color:var(--lb-chip-bg);color:var(--lb-muted)}
.lb-chip[data-taste=liked]{background-color:var(--color-cherry-background);color:var(--color-red-like)}
.lb-chip[data-taste=disliked]{background-color:var(--lb-chip-bg);color:var(--lb-muted)}
.lb-chips{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.lb-chip[hidden]{display:none}
.lb-table{width:100%;border-collapse:collapse;font-family:var(--lb-font);color:var(--lb-fg)}
.lb-table th,.lb-table td{text-align:start;padding:0.5rem 0.4rem;
border-bottom:1px solid var(--lb-border);vertical-align:middle;font-size:0.8125rem}
.lb-table th{font-size:0.75rem;font-weight:600;color:var(--lb-muted);
text-transform:uppercase;letter-spacing:.04em}
.lb-link{color:var(--color-blue-foreground);text-decoration:none}
.lb-link:hover{text-decoration:underline}
/* Quiet text link out of the artifact. Button-height so it shares the row's
   baseline; understated so it never competes with the actions beside it. The
   arrow is a bare diagonal stroke — an escape-hatch marker, not an icon that
   asks to be read. */
.lb-link-out{display:inline-flex;align-items:center;gap:.3rem;
font-size:0.75rem;line-height:1rem;min-height:2.125rem;
color:var(--lb-fg);text-decoration:none;opacity:.65;transition:opacity .15s}
.lb-link-out:hover{opacity:1;text-decoration:underline}
.lb-link-out:focus-visible{outline:2px solid var(--color-blue-foreground);outline-offset:1px;
border-radius:var(--lb-radius-sm)}
.lb-link-out svg{width:.85em;height:.85em;flex-shrink:0}
/* Pushes whatever follows it to the right edge of an .lb-row, so a trailing
   link sits on the SAME baseline as the row's buttons instead of on its own
   line below them. */
/* A spacer only aligns items on its OWN flex line. .lb-row wraps, so once the
   link falls to a second line the spacer stays behind and the link renders
   left-aligned — the opposite of what the contract promises. The auto margin
   re-anchors it to the trailing edge of whichever line it lands on, and is a
   no-op while the row is unwrapped. */
.lb-spacer{flex:1 1 auto;min-width:0}
.lb-row>.lb-link-out{margin-inline-start:auto}
.lb-spinner{display:inline-block;width:.7em;height:.7em;border:2px solid var(--lb-border);
border-top-color:var(--color-blue-foreground);border-radius:50%;animation:lb-spin .8s linear infinite}
@keyframes lb-spin{to{transform:rotate(1turn)}}
/* animation:none left a static ring — under reduced motion "sending" and
   "cannot click" looked identical. An opacity pulse is the sanctioned
   substitute. The 150ms colour fade is fine and stays. */
@media(prefers-reduced-motion:reduce){.lb-spinner{animation:lb-pulse 1.4s ease-in-out infinite}}
@keyframes lb-pulse{50%{opacity:.35}}
`;

/** id on the injected <style> — also the idempotency key. */
export const STYLE_ELEMENT_ID = "lb-styles";
