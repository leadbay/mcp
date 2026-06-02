/**
 * leadbay_my_lenses — list the user's lenses, switch the active one, or rename one.
 *
 * Default-surface composite. With no args it is a pure read: GET /lenses,
 * merged with the active lens from /users/me.last_requested_lens (more
 * reliable than the payload's per-row is_last_active, which can be stale).
 *
 * - switchToLensId → POST /lenses/{id}/update_last_requested, invalidate caches,
 *   return the REFRESHED list with the new active marked.
 * - renameLensId + newName → POST /lenses/{id} {name}, return the refreshed list.
 *
 * IMPORTANT: lens ids are STRINGS server-side (e.g. "40005"). We compare and
 * carry them as strings here — comparing a string id against a numeric param
 * silently fails (`"40005" === 40005` is false), which previously made switch
 * report "no lens with id …" for a lens that was right there in the list.
 *
 * Distinct from the granular leadbay_list_lenses / leadbay_set_active_lens /
 * leadbay_update_lens (advanced-gated primitives) — this is the on-pattern
 * default-surface tool with routing + rendering.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, LensPayload } from "../types.js";

import { leadbay_my_lenses as MY_LENSES_DESCRIPTION } from "../tool-descriptions.generated.js";

interface MyLensesParams {
  switchToLensId?: string | number;
  renameLensId?: string | number;
  newName?: string;
}

interface LensListEntry {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
}

// Normalize any id (string or number) to the string form the backend uses.
const sid = (v: string | number | null | undefined): string | null =>
  v == null ? null : String(v);

async function listWithActive(
  client: LeadbayClient
): Promise<{ lenses: LensListEntry[]; active_lens_id: string | null }> {
  const lenses = await client.request<LensPayload[]>("GET", "/lenses");
  // Prefer /me.last_requested_lens for active state; fall back to the per-row
  // is_last_active flag if /me is unavailable. Compare as strings.
  const me = await client.resolveMe().catch(() => null);
  const activeFromMe = sid(me?.last_requested_lens);
  const active_lens_id =
    activeFromMe ?? sid(lenses.find((l) => l.is_last_active)?.id) ?? null;

  return {
    active_lens_id,
    lenses: lenses.map((l) => ({
      id: sid(l.id) as string,
      name: l.name,
      description: l.description ?? null,
      is_active: sid(l.id) === active_lens_id,
    })),
  };
}

export const myLenses: Tool<MyLensesParams> = {
  name: "leadbay_my_lenses",
  annotations: {
    title: "List, switch, or rename your lenses",
    // No args → pure read. switch/rename mutate, so not flagged read-only, but
    // they never destroy data and re-calling with the same args is a no-op.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: MY_LENSES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      switchToLensId: {
        type: ["string", "number"],
        description:
          "When set, switch the active lens to this id (must be one of the user's lenses), then return the refreshed list.",
      },
      renameLensId: {
        type: ["string", "number"],
        description:
          "When set (with newName), rename this lens. Must be one of the user's lenses.",
      },
      newName: {
        type: "string",
        description: "The new name — required when renameLensId is set.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "'listed', 'switched', 'renamed', or 'not_found' (unknown switch/rename id).",
      },
      switched: { type: "boolean", description: "True when this call changed the active lens." },
      renamed: { type: "boolean", description: "True when this call renamed a lens." },
      active_lens_id: { type: ["string", "null"] },
      lenses: {
        type: "array",
        description: "The user's lenses. Each: {id, name, description, is_active}.",
        items: { type: "object" },
      },
      message: { type: "string" },
    },
    required: ["status", "lenses", "active_lens_id"],
  },
  execute: async (client: LeadbayClient, params: MyLensesParams) => {
    // Rename path — validate the target, POST the new name, return refreshed list.
    if (params.renameLensId != null) {
      const targetId = sid(params.renameLensId)!;
      const before = await listWithActive(client);
      const target = before.lenses.find((l) => l.id === targetId);
      if (!target) {
        return {
          status: "not_found",
          switched: false,
          renamed: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `No lens with id ${targetId}. Pick one from the list.`,
        };
      }
      const newName = (params.newName ?? "").trim();
      if (newName === "") {
        return {
          status: "not_found",
          switched: false,
          renamed: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `Provide a newName to rename "${target.name}".`,
        };
      }

      await client.requestVoid("POST", `/lenses/${targetId}`, { name: newName });
      client.invalidateDefaultLens();

      const after = await listWithActive(client);
      return {
        status: "renamed",
        switched: false,
        renamed: true,
        active_lens_id: after.active_lens_id,
        lenses: after.lenses,
        message: `Renamed "${target.name}" → "${newName}".`,
      };
    }

    // Switch path — validate the target is a real lens before POSTing.
    if (params.switchToLensId != null) {
      const targetId = sid(params.switchToLensId)!;
      const before = await listWithActive(client);
      const target = before.lenses.find((l) => l.id === targetId);
      if (!target) {
        return {
          status: "not_found",
          switched: false,
          renamed: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `No lens with id ${targetId}. Pick an id from the list.`,
        };
      }
      if (target.is_active) {
        return {
          status: "switched",
          switched: false,
          renamed: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `"${target.name}" is already your active lens.`,
        };
      }

      await client.requestVoid("POST", `/lenses/${targetId}/update_last_requested`);
      // last_requested_lens lives in the /me + default-lens caches — drop both
      // so the refreshed list reflects the change.
      client.invalidateMe();
      client.invalidateDefaultLens();

      const after = await listWithActive(client);
      return {
        status: "switched",
        switched: true,
        renamed: false,
        active_lens_id: after.active_lens_id,
        lenses: after.lenses,
        message: `Now showing "${target.name}".`,
      };
    }

    // List path (pure read).
    const { lenses, active_lens_id } = await listWithActive(client);
    return { status: "listed", switched: false, renamed: false, active_lens_id, lenses };
  },
};
