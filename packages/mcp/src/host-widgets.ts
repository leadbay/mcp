/**
 * Host-native widget routing instruction.
 *
 * Spliced into `buildServerInstructions` so the agent knows that
 * Claude / ChatGPT chat hosts expose their own first-party widgets
 * for the most common output shapes — and that those, not our own
 * iframe-style widgets, are the right surface. (The iframe-style
 * widgets were a 0.10.0-dev.x experiment that didn't ship — see
 * /CLAUDE.md "MCP Apps widget pipeline — DEPRECATED".)
 *
 * The paragraph self-conditions ("when your host exposes…") so hosts
 * that don't have a given widget skip silently; the agent falls back
 * to the canonical RENDERING block (markdown table / card / chips)
 * the per-tool description specifies.
 */
export const BUILTIN_WIDGETS_PARAGRAPH =
  "Prefer host-native widgets over inline markdown when the data shape fits. " +
  "Three to know: (1) `places_map_display_v0` — for ≥2 locations / map / travel intent. " +
  "Pass `{name, address, latitude, longitude, notes}` per location; the host enriches via Google Places. " +
  "(2) `message_compose_v1` — for any outreach draft (email / message / call opener). " +
  "Pass 2–3 strategic variants with goal-oriented labels (\"Push for alignment\", \"Reference M&A signal\") — NOT tone labels. " +
  "(3) The next-step / choice widget — for the NEXT STEPS questions every Leadbay tool emits. " +
  "Its NAME AND SCHEMA differ by host; use whichever is in your tool set: " +
  "(a) `ask_user_input_v0` (Claude chat / ChatGPT) — options are PLAIN STRINGS with `type: \"single_select\"`, " +
  "e.g. `{questions:[{question:\"What next?\",type:\"single_select\",options:[\"Build a triage board\",\"Pull next page\"]}]}`. " +
  "(b) `AskUserQuestion` (Claude cowork / Claude Code) — options are OBJECTS `{label, description}`, plus a required " +
  "short `header` (≤12 chars) and a `multiSelect` boolean, and NO `type` field; do not add an \"Other\" option (the host adds it). " +
  "e.g. `{questions:[{question:\"What next?\",header:\"Next step\",multiSelect:false,options:[{label:\"Triage board\",description:\"Build an interactive board to sort this batch.\"},{label:\"Next page\",description:\"Pull page 2.\"}]}]}`. " +
  "Match the schema to the tool you actually have — using the string-schema for AskUserQuestion (or vice-versa) makes the call fail and you silently fall back to prose. " +
  "When the host exposes NEITHER widget, fall back to the per-tool markdown RENDERING block.\n\n" +
  "WIDGET IS MANDATORY WHEN AVAILABLE: if EITHER `ask_user_input_v0` OR `AskUserQuestion` is present in " +
  "your tool set, you MUST emit your NEXT STEPS / scheduling / artifact offer by CALLING that widget tool " +
  "(with its correct schema above) — do NOT write the options out as a prose question (\"Want me to run this " +
  "every morning?\", \"Should I build a board?\"). Prose for these offers is the FALLBACK reserved ONLY for " +
  "hosts that expose neither widget. When the widget exists, presenting the same choices as prose instead of " +
  "calling it is a defect: the user loses the click-to-select surface. So whenever you have a recurring-task " +
  "offer, an artifact offer, or a 2–4 option next-step menu AND a widget tool is available → call it, every time.";
