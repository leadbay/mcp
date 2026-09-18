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
/* Purple carries the product's "AI" affordance (Qualify / Requalify). The
   border is the foreground at 65% transparency, exactly as the style package
   derives every *-border token. */
--color-purple-background:oklch(0.947 0.029 288);--color-purple-foreground:oklch(0.464 0.181 288);
--color-purple-border:color-mix(in oklch,var(--color-purple-foreground),transparent 65%);
/* Teal carries the qualifier's intent tags, as the product's taste-profile
   tags do. Border derived at 65% transparency, like every *-border token. */
--color-teal-background:oklch(0.977 0.019 180);--color-teal-foreground:oklch(0.574 0.182 180);
--color-teal-border:color-mix(in oklch,var(--color-teal-foreground),transparent 65%);
--color-red-like:var(--color-cherry-foreground);
--lb-font:"Nikkei Maru",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
/* Concentric: outer = inner + padding (0.625 + 0.875 = 1.5rem). The card's
   padding is what closes this equation, so the two move together — see
   .lb-card, which pads 0.875rem for exactly this reason. */
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
/* macOS renders text heavier than intended. This belongs once on the root,
   never per component — an artifact that injects this sheet gets it for free
   instead of each page re-declaring it on its own body. */
-webkit-font-smoothing:antialiased;
-moz-osx-font-smoothing:grayscale;
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
--color-purple-background:oklch(0.30 0.055 288);--color-purple-foreground:oklch(0.82 0.11 288);
--color-teal-background:oklch(0.30 0.055 180);--color-teal-foreground:oklch(0.82 0.11 180);
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
--color-purple-background:oklch(0.30 0.055 288);--color-purple-foreground:oklch(0.82 0.11 288);
--color-teal-background:oklch(0.30 0.055 180);--color-teal-foreground:oklch(0.82 0.11 180);
}}
/* 0.875rem padding is not arbitrary: it closes the concentric equation with
   --lb-radius (1.5rem) and --lb-radius-sm (0.625rem). Changing it without
   moving --lb-radius leaves a control's arc running wider than the card's in
   the corner. */
.lb-card{display:grid;gap:var(--lb-gap);padding:0.875rem;
background-color:var(--lb-surface);border:1px solid var(--lb-border);
border-radius:var(--lb-radius);corner-shape:squircle;color:var(--lb-fg);
font-family:var(--lb-font);
box-shadow:var(--lb-shadow)}
/* ── Card layout ────────────────────────────────────────────────────────────
   A lead card is a stack of SECTIONS, each a titled block (Fit, Intent tags,
   Data, Status, Outreach). One wrapper owns the rhythm — 16px between
   sections, 8px between the items inside one — so a section can be added,
   removed or reordered without touching spacing, and no margin can collapse.
   Every artifact that builds cards gets the same geometry from here rather
   than hand-rolling it. */
.lb-sections{display:flex;flex-direction:column;gap:1rem}
.lb-section{display:grid;gap:0.5rem}
/* A section title: black, uppercase, tracked. It names the block below it, so
   it must sit at SECTION level — nested inside a row it stops being a peer of
   the other titles and the card loses its scan order. */
.lb-sec-title{font-size:0.75rem;font-weight:700;letter-spacing:.08em;
text-transform:uppercase;color:var(--lb-fg);line-height:1.4;
text-wrap:balance}
/* Header row: leading control (a bulk checkbox), the title, then trailing
   controls (taste) pushed to the far edge. */
.lb-card-top{display:flex;align-items:center;gap:0.625rem;flex-wrap:wrap}
.lb-card-top>.lb-group{flex:0 0 auto;margin-inline-start:auto}
.lb-card-top>input[type=checkbox]{flex:0 0 auto;width:1rem;height:1rem;margin:0}
/* The company name. Bold and underlined so it reads as the card's subject and
   as a link, without competing with the uppercase section titles. */
/* text-wrap:balance keeps a two-line company name from breaking one-word-over;
   the underline takes its position and thickness from the font's own metrics
   rather than wherever the browser puts them, and skip-ink clears descenders. */
.lb-lead-title{flex:1 1 9rem;min-width:0;font-size:0.9375rem;font-weight:700;
line-height:1.3;color:var(--lb-fg);text-wrap:balance;text-decoration:underline;
text-underline-position:from-font;text-decoration-thickness:from-font;
text-underline-offset:2px;text-decoration-skip-ink:auto;overflow-wrap:break-word}
.lb-lead-title a{color:inherit;text-decoration:inherit}
/* Controls in a section stack, each spanning it, so every control on the card
   shares one leading edge and one width. Three different widths across a row
   read as three unrelated things. */
.lb-section>.lb-select,.lb-section>.lb-input,
.lb-stack>.lb-select,.lb-stack>.lb-input,.lb-stack>.lb-btn{width:100%;min-width:0}
/* Footer: a leading action, a spacer, a trailing escape hatch. */
.lb-card-foot{display:flex;align-items:center;gap:0.625rem;
padding-block-start:0.875rem;border-block-start:1px solid var(--lb-border)}
.lb-card-foot .lb-spacer{flex:1 1 auto}
/* ── Toolbar ────────────────────────────────────────────────────────────────
   The bar above a deck of cards: a tally, the controls that narrow what is
   shown, and the controls that act on a selection. Those are three different
   jobs, so they are three groups — 0.5rem within one, 1.5rem between — rather
   than one flat row where "apply to selected" reads as another filter.
   Concentric: it pads 0.75rem around controls that round at 0.625rem, so it
   rounds at 1.375rem. */
.lb-toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:0.75rem 1.5rem;
padding:0.75rem 1rem;background-color:var(--lb-surface);
border:1px solid var(--lb-border);border-radius:1.375rem;corner-shape:squircle;
font-family:var(--lb-font);color:var(--lb-fg)}
.lb-toolbar .lb-group{gap:0.5rem}
/* A labelled control stacks: caption above, control below, as a card section
   does. One label pattern across the whole artifact. */
.lb-field{display:inline-flex;flex-direction:column;align-items:flex-start;
gap:0.25rem;font-size:0.8125rem;line-height:1.4;color:var(--lb-muted);
white-space:nowrap}
/* A checkbox belongs BESIDE its words — under a caption it reads as orphaned. */
.lb-field-inline{flex-direction:row;align-items:center;gap:0.5rem}
/* A control's caption is not body copy: it names the control, so it takes the
   same treatment as a card's section title. */
.lb-field-label{font-size:0.75rem;font-weight:700;letter-spacing:.08em;
text-transform:uppercase;color:var(--lb-fg)}
/* A labelled field sizes to its own content, so width:100% on the control
   inside only fills whatever the field already became. Two fields side by side
   still come out unequal — they have no shared reference to be equal against.
   Give the FIELD the basis: flex:1 1 9rem makes every labelled field claim the
   same share of the row, so a select and a text input beside it match. */
.lb-field{flex:1 1 9rem;min-width:9rem;max-width:16rem}
.lb-field>.lb-select,.lb-field>.lb-input{width:100%;min-width:0}
/* An inline field holds a checkbox, not a sized control: natural width, no floor. */
.lb-field-inline{flex:0 0 auto;min-width:0;max-width:none}
.lb-field-inline>*{min-width:0;width:auto;flex:0 0 auto}
/* Readouts sit on the control baseline, not the caption's. */
.lb-toolbar .lb-tally,.lb-toolbar .lb-status{align-self:center}
.lb-tally{font-size:0.8125rem;line-height:1.4;color:var(--lb-muted);
font-variant-numeric:tabular-nums;white-space:nowrap}
/* Connection state, never carried by colour alone: live is a filled dot, dead
   a hollow ring, so the two differ in shape as well as hue — a red and a green
   circle are the same circle to a colour-blind reader, and identical under
   forced colours. */
.lb-status{display:inline-flex;align-items:center;gap:0.5rem;
font-size:0.75rem;line-height:1.4;color:var(--lb-muted);white-space:nowrap}
.lb-status-dot{width:0.5rem;height:0.5rem;border-radius:50%;flex:none;
background-color:var(--color-gray-5);border:2px solid transparent}
.lb-status[data-live=yes] .lb-status-dot{background-color:var(--color-green-foreground)}
.lb-status[data-live=no] .lb-status-dot{background-color:transparent;
border-color:var(--color-red-foreground)}
/* ── Pager ──────────────────────────────────────────────────────────────────
   Below a deck, never above it: the rep reads the rows, then decides whether
   to go on. The range ("21–40 of 60") is the honest label — "page 2" alone
   does not say how much is left, and a rep who cannot see the end cannot tell
   a short lens from a long one. Tabular, because the numbers change. */
.lb-pager{display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap}
.lb-pager .lb-spacer{flex:1 1 auto}
.lb-pager-range{font-size:0.8125rem;line-height:1.4;color:var(--lb-muted);
font-variant-numeric:tabular-nums;white-space:nowrap}
/* ── Metrics + chart ────────────────────────────────────────────────────────
   A manager dashboard reports before it lists: a row of figures, then the
   trend behind them, then the per-rep table. Tiles are for the few numbers
   that ARE the point — a tile per field turns a dashboard into a wall. */
.lb-tiles{display:grid;gap:0.75rem;
grid-template-columns:repeat(auto-fit,minmax(min(9rem,100%),1fr))}
.lb-tile{display:grid;gap:0.25rem;padding:0.75rem 0.875rem;
background-color:var(--lb-field);border:1px solid var(--lb-border);
border-radius:1.375rem;corner-shape:squircle}
.lb-tile-label{font-size:0.75rem;font-weight:700;letter-spacing:.08em;
text-transform:uppercase;color:var(--lb-muted);line-height:1.4}
.lb-tile-value{font-size:1.5rem;font-weight:700;line-height:1.15;
color:var(--lb-fg);font-variant-numeric:tabular-nums}
/* The chart draws from the theme tokens, so it reads in light and dark alike;
   a hardcoded stroke disappears on one of the two. Inline SVG rather than a
   CDN library: a sparse weekly series does not earn 200KB, and an artifact
   that silently fails to load its chart shows nothing at all. */
.lb-chart{display:block;width:100%;height:auto}
.lb-chart .lb-chart-grid{stroke:var(--lb-border);stroke-width:1}
.lb-chart .lb-chart-line{fill:none;stroke:var(--color-blue-foreground);stroke-width:2;
stroke-linejoin:round;stroke-linecap:round}
.lb-chart .lb-chart-area{fill:var(--color-blue-background);opacity:.55}
.lb-chart .lb-chart-dot{fill:var(--color-blue-foreground)}
/* Axis labels are UI text and take the same 12px floor as everything else —
   a chart is not a licence to shrink type below what is readable. */
.lb-chart text{fill:var(--lb-muted);font-family:var(--lb-font);font-size:0.75rem}
/* An empty series is a real answer, not a failure: say so in place of the
   chart rather than drawing empty axes that look broken. */
.lb-empty{display:grid;place-items:center;gap:0.25rem;padding:1.5rem 1rem;
background-color:var(--lb-field);border:1px dashed var(--lb-border);
border-radius:1.375rem;corner-shape:squircle;text-align:center}
.lb-empty-title{font-size:0.8125rem;font-weight:600;color:var(--lb-fg);line-height:1.4}
.lb-empty-hint{font-size:0.78125rem;color:var(--lb-muted);line-height:1.45;max-width:44ch}
/* A page flip replaces the whole deck, so the rows must read as pending or the
   rep cannot tell a slow page from a finished one. Dim and lock the deck
   rather than blanking it: keeping the old rows on screen preserves the
   scroll position and the sense of place. */
.lb-deck[data-lb-state=loading]{opacity:.55;pointer-events:none}
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
/* pretty stops a lone word landing on the last line of a why-it-fits sentence
   or a fact — the orphan that makes a card look unfinished. */
.lb-sub{font-size:0.8125rem;line-height:1.45;color:var(--lb-muted);
text-wrap:pretty;overflow-wrap:break-word;max-width:68ch}
/* An empty fact line is a 30px void that reads as a rendering bug. */
.lb-sub:empty{display:none}
/* The tightest group on the card: consecutive data lines (the contact, then
   the company switchboard) are one block, so they sit at HALF the section's
   own 8px. That 2x ratio is what makes them read as a unit rather than as
   separate facts — the same rule .lb-section applies one level up against
   .lb-sections' 16px. The scale halves at each level: 16 → 8 → 4. */
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
/* 8px, matching .lb-section — a stack inside a section must not space its
   controls wider than the section spaces its own children. */
.lb-stack{display:grid;gap:0.5rem}
/* A select is border-box by UA default; a text input is content-box. Given the
   same width, padding and border, the input therefore renders ~2rem wider — the
   padding lands outside its box and inside the select's. Neither is wrong on its
   own; they just cannot be sized together until they agree. Every control the
   kit styles is border-box, so a declared width is the width that shows. */
.lb-btn,.lb-select,.lb-input{box-sizing:border-box}
.lb-select,.lb-input{font:inherit;font-family:var(--lb-font);font-size:0.8125rem;color:var(--lb-fg);
background-color:var(--lb-field);border:1px solid var(--lb-control-border);
border-radius:var(--lb-radius-sm);corner-shape:squircle;padding:0.4rem 0.55rem;min-height:2.125rem}
/* Geometry, states and motion ported from the product's Button component
   (packages/ui/components/Button) so an artifact button and an app button are
   the same object. MUI spacing is 8px/unit, so its size=medium (py .875,
   px .875, borderRadius .875) is 7px/7px/7px and large (py 1.75, px 2,
   borderRadius 1.25) is 14px/16px/10px. A control sitting in a row beside a
   select reads as medium, so that is the default here; .lb-btn-lg opts into
   large. The app's default variant is secondary — white ground, gray-5
   border, black text — which is what an unadorned .lb-btn already was. */
.lb-btn{font:inherit;font-family:var(--lb-font);font-size:0.8125rem;font-weight:600;
color:var(--color-black);background-color:var(--color-white);
border:1px solid var(--color-gray-5);
border-radius:0.4375rem;corner-shape:squircle;padding:0.4375rem 0.4375rem;min-height:2.125rem;
cursor:pointer;user-select:none;-webkit-user-select:none;text-wrap:nowrap;
font-variant-numeric:tabular-nums;
transition:background-color .16s ease,border .16s ease,color .16s ease,
opacity .16s ease,transform .16s cubic-bezier(0.23,1,0.32,1)}
/* The app hovers the GROUND to gray-2, not the border. */
@media (hover:hover){
.lb-btn:hover:not([disabled]):not([data-lb-state=loading]){
background-color:var(--color-gray-2)}}
/* Front-loaded press, so the tap leads the colour crossfade. */
.lb-btn:active:not([disabled]):not([data-lb-state=loading]){transform:scale(0.97)}
.lb-btn[disabled]{opacity:.4;cursor:default}
/* A text button with a label + icon: the app lays the content out as a flex row
   with a 6px gap (its content style uses gap 0.75). */
.lb-btn{display:inline-flex;align-items:center;justify-content:center;gap:0.375rem}
.lb-btn>svg{display:block;flex-shrink:0;width:1.05rem;height:1.05rem}
/* Opt-in large, for a button that stands alone rather than in a control row. */
.lb-btn-lg{border-radius:0.625rem;padding:0.875rem 1rem}
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
/* This is the app's primary variant verbatim: black ground, white text, and a
   hover that mixes 32% gray-8 into the black rather than lightening opacity. */
.lb-btn-submit{background-color:var(--lb-fg);color:var(--lb-field);
border-color:var(--lb-fg)}
@media (hover:hover){
.lb-btn-submit:hover:not([disabled]):not([data-lb-state=loading]){
background-color:color-mix(in oklch,var(--lb-fg),var(--color-gray-8) 32%);
border-color:color-mix(in oklch,var(--lb-fg),var(--color-gray-8) 32%)}}
/* The app's ai variant — what QualifyButton/Requalify wears. Purple ground,
   purple-foreground text, border at 65% transparency of the foreground; hover
   mixes 7% black into the ground. Tokens mirror the product's style package. */
.lb-btn-ai{background-color:var(--color-purple-background);
border-color:var(--color-purple-border);color:var(--color-purple-foreground)}
@media (hover:hover){
.lb-btn-ai:hover:not([disabled]):not([data-lb-state=loading]){
background-color:color-mix(in oklch,var(--color-purple-background),black 7%)}}
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
.lb-chips{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap}
/* ── Tag rows ───────────────────────────────────────────────────────────────
   Two kinds, deliberately different so they never read as the same axis.
   FIRMOGRAPHIC (.lb-tags-plain): what the company IS — location, size, sector.
   Quiet grey, because it is context the rep skims.
   INTENT (.lb-tags-intent): what the qualifier FOUND — a buying signal. Teal,
   matching the product's own taste-profile tags, because it is the reason the
   lead is on screen. Both wrap and both sit on the section's 8px. */
.lb-tags-plain,.lb-tags-intent{display:flex;flex-wrap:wrap;gap:0.5rem}
/* Both tags round at 0.375rem: they are the innermost surface, and a tag whose
   radius drifts from its neighbours reads as a different kind of object. Their
   own padding is small enough that concentric math against the card does not
   apply — past a point the layers are separate surfaces, each chosen on its
   own. */
.lb-tags-plain>*{display:inline-flex;align-items:center;
background-color:var(--lb-surface);border:1px solid var(--lb-border);
color:var(--lb-muted);border-radius:0.375rem;padding:0.125rem 0.375rem;
font-size:0.75rem;font-weight:500;line-height:1.5;white-space:nowrap}
.lb-tags-intent>*{display:inline-flex;align-items:center;
background-color:var(--color-teal-background);border:1px solid var(--color-teal-border);
color:var(--color-teal-foreground);border-radius:0.375rem;padding:0.1875rem 0.4375rem;
font-size:0.75rem;line-height:1.4}
/* The honest empty state: a blank tag row reads as a rendering bug, so say
   what is missing and what fixes it. */
.lb-tags-empty{font-size:0.78125rem;line-height:1.45;color:var(--lb-muted);
font-style:italic}
/* The chips row is empty until a taste or a status lands. Left in flow it is a
   zero-height element that still consumes the gap above the first section, so
   hide it while it holds nothing — set the hidden attribute from the code that
   paints the chips, since it is that code which knows. */
.lb-chips[hidden]{display:none}
.lb-chip[hidden]{display:none}
.lb-table{width:100%;border-collapse:collapse;font-family:var(--lb-font);color:var(--lb-fg)}
.lb-table th,.lb-table td{text-align:start;padding:0.5rem 0.4rem;
border-bottom:1px solid var(--lb-border);vertical-align:middle;font-size:0.8125rem}
.lb-table th{font-size:0.75rem;font-weight:600;color:var(--lb-muted);
text-transform:uppercase;letter-spacing:.04em}
/* Counts line up only when the digits do; a leaderboard whose numbers jitter
   column-to-column cannot be scanned down. */
.lb-table td[data-num],.lb-table th[data-num]{text-align:end;
font-variant-numeric:tabular-nums}
/* A sortable header is a control: it must look clickable and say which way it
   is sorting, in text as well as by arrow — aria-sort is the accessible half. */
.lb-table th[aria-sort]{cursor:pointer;user-select:none;color:var(--lb-fg)}
.lb-table th[aria-sort]:hover{text-decoration:underline}
.lb-table th[aria-sort=ascending]::after{content:" \\2191"}
.lb-table th[aria-sort=descending]::after{content:" \\2193"}
.lb-table th[aria-sort=none]::after{content:" \\2195";opacity:.35}
/* The row a manager is acting on. */
.lb-table tbody tr[aria-selected=true]{background-color:var(--lb-chip-bg)}
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
