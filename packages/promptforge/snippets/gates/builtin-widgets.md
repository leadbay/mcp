## GATE — PREFER BUILT-IN HOST WIDGETS

Modern chat hosts (Claude, ChatGPT) expose first-party widgets the agent can route into. These ALWAYS produce a better UX than markdown tables / inline prose for the data shapes they support — they're tappable on mobile, persistent across turns, and integrate with the host's quick-actions.

**The Big Three** — when a tool result fits, route there:

| Host widget | Use when | Field map (from Leadbay payload) |
|---|---|---|
| `places_map_display_v0` (Claude) | Result has ≥2 leads with `location.city` set, and the user's intent is geographic / "in person" / travel | `{name: lead.company_name, address: "<city>, <country>", place_id: lead.location.place_id ?? omit, notes: <one-sentence pitch>}` per location |
| `message_compose_v1` (Claude) | You're about to draft outreach (email / message / call opener) | `{kind: "email", summary_title, variants: [{label, body, subject}]}` — 2–3 variants, labels describe STRATEGY ("Push for alignment", "Reference the M&A signal"), not tone ("Friendly", "Formal") |
| `ask_user_input_v0` (Claude chat / ChatGPT) **or** `AskUserQuestion` (Claude cowork / Claude Code) — whichever is in your tool set; their schemas differ, match the one you have | The tool's NEXT STEPS block has 2–4 mutually-exclusive next moves and the user hasn't already chosen | Per-tool schema in the server instructions + NEXT STEPS routing block. Max 3 questions. |

ChatGPT exposes the same routing pattern via `_meta.openai/outputTemplate`. We don't ship any custom widgets ourselves — this gate is exclusively about routing into the host's first-party widgets when the data shape fits.

**Rules:**
- The widget IS the visual. Do NOT emit a markdown table or prose list of the same data alongside — that produces two competing UIs.
- Pass identifiers (place_id, lead.id, contact_id) verbatim. Don't rewrite.
- When the host doesn't expose the named widget, the agent falls back to the prose/table rendering the per-tool description already specifies. The directive is host-conditional; the fallback is automatic.
- One short intro sentence in chat is enough — "Here are your 5 NYC follow-ups." Then route into the widget.
