/**
 * leadbay_followups_map — same backend as leadbay_pull_followups, but
 * named distinctly so the agent has an explicit entry point for travel
 * / in-person / "I'm going to <city>" intent.
 *
 * INTENTIONALLY UNBOUND from a `_meta.ui` widget. Earlier iterations
 * pointed `_meta.ui.resourceUri` at `ui://leadbay/map`, which made hosts
 * auto-render our own map widget. Three things broke:
 *   1. The auto-rendered widget short-circuited the LLM's routing —
 *      it never invoked Claude's native `places_map_display_v0` (richer,
 *      Google-resolved place data, the carousel UX users prefer).
 *   2. Our widget itself rendered poorly in cowork's auto-sized iframe
 *      sandbox (the MapLibre canvas row collapsed to 0 height), so users
 *      saw a blank box where the map should be.
 *   3. We were fighting the host's native rendering pipeline instead of
 *      feeding it.
 *
 * The fix: drop the widget binding. The description routes the agent
 * to host-native widgets (`places_map_display_v0` when exposed) and to
 * the place-card-friendly prose blocks as a universal fallback. The map
 * widget code stays in the repo and is still resolvable at
 * `ui://leadbay/map` for any host that fetches it directly.
 */

import type { Tool } from "../types.js";
import { pullFollowups } from "./pull-followups.js";
import { leadbay_followups_map as FOLLOWUPS_MAP_DESCRIPTION } from "../tool-descriptions.generated.js";

export const followupsMap: Tool = {
  name: "leadbay_followups_map",
  // NO ui binding — see the file-level comment above. The agent
  // routes into host-native widgets via the description's RENDER
  // directives instead of an auto-rendered MCP Apps widget.
  annotations: {
    title: "Plot follow-up leads on a map (travel / in-person intent)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: FOLLOWUPS_MAP_DESCRIPTION,
  // Delegate everything else verbatim — same params, same output, same
  // city resolver / set_filter / pushback exclusion behavior.
  inputSchema: pullFollowups.inputSchema,
  outputSchema: pullFollowups.outputSchema,
  execute: pullFollowups.execute,
};
