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
  editLensId?: string | number; // rename and/or re-describe a lens
  newName?: string;
  newDescription?: string;
  deleteLensId?: string | number;
  confirm?: boolean; // required (=true) to actually delete; otherwise previews
}

interface LensListEntry {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  is_default: boolean;
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
      is_default: l.is_default === true || (l as { default?: boolean }).default === true,
    })),
  };
}

export const myLenses: Tool<MyLensesParams> = {
  name: "leadbay_my_lenses",
  annotations: {
    title: "List, switch, edit, or delete your lenses",
    // No args → pure read. The delete mode issues DELETE /lenses/:id (an
    // irreversible side effect), so the tool is destructive — clients must
    // treat it as approval-required, not auto-run. The delete path is itself
    // confirm-gated (preview unless confirm:true). switch/edit are not
    // idempotent across modes either, so don't claim idempotency.
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
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
      editLensId: {
        type: ["string", "number"],
        description:
          "When set, edit this lens's metadata — provide newName and/or newDescription. Must be one of the user's lenses.",
      },
      newName: {
        type: "string",
        description: "New lens name (used with editLensId).",
      },
      newDescription: {
        type: "string",
        description:
          "New lens description (used with editLensId). Pass an empty string to clear it.",
      },
      deleteLensId: {
        type: ["string", "number"],
        description:
          "When set, delete this lens. DESTRUCTIVE — returns a delete_preview unless confirm:true. Cannot delete the default lens.",
      },
      confirm: {
        type: "boolean",
        description:
          "Required (=true) to actually delete. Without it, deleteLensId returns a preview to confirm with the user first.",
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
          "'listed', 'switched', 'edited', 'deleted', 'delete_preview' (confirm to proceed), 'cannot_delete_default', or 'not_found'.",
      },
      switched: { type: "boolean", description: "True when this call changed the active lens." },
      edited: { type: "boolean", description: "True when this call renamed/re-described a lens." },
      deleted: { type: "boolean", description: "True when this call deleted a lens." },
      will_delete: {
        type: "object",
        description: "On 'delete_preview': the lens that WILL be deleted {id, name}. Nothing removed yet.",
      },
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
    // Delete path — destructive, so confirm-gated. Validate target, refuse the
    // default lens up front (backend rejects it anyway), preview unless confirmed.
    if (params.deleteLensId != null) {
      const targetId = sid(params.deleteLensId)!;
      const before = await listWithActive(client);
      const target = before.lenses.find((l) => l.id === targetId);
      if (!target) {
        return {
          status: "not_found",
          switched: false,
          edited: false,
          deleted: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `No lens with id ${targetId}. Pick one from the list.`,
        };
      }
      if (target.is_default) {
        return {
          status: "cannot_delete_default",
          switched: false,
          edited: false,
          deleted: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `"${target.name}" is the default lens and can't be deleted.`,
        };
      }
      if (params.confirm !== true) {
        return {
          status: "delete_preview",
          switched: false,
          edited: false,
          deleted: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          will_delete: { id: target.id, name: target.name },
          message: `About to delete "${target.name}". This can't be undone. Confirm with the user, then re-call with confirm:true.`,
        };
      }

      await client.requestVoid("DELETE", `/lenses/${targetId}`);
      // Deleting the active lens clears last_requested_lens server-side.
      client.invalidateMe();
      client.invalidateDefaultLens();

      const after = await listWithActive(client);
      return {
        status: "deleted",
        switched: false,
        edited: false,
        deleted: true,
        active_lens_id: after.active_lens_id,
        lenses: after.lenses,
        message: `Deleted "${target.name}".`,
      };
    }

    // Edit path — rename and/or re-describe a lens. Both go through the same
    // POST /lenses/:id; set newName, newDescription, or both in one call.
    if (params.editLensId != null) {
      const targetId = sid(params.editLensId)!;
      const before = await listWithActive(client);
      const target = before.lenses.find((l) => l.id === targetId);
      if (!target) {
        return {
          status: "not_found",
          switched: false,
          edited: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `No lens with id ${targetId}. Pick one from the list.`,
        };
      }

      const body: { name?: string; description?: string } = {};
      const newName = params.newName?.trim();
      if (newName) body.name = newName;
      // Allow clearing the description with an explicit empty string.
      if (params.newDescription !== undefined) body.description = params.newDescription;

      if (Object.keys(body).length === 0) {
        return {
          status: "not_found",
          switched: false,
          edited: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `Nothing to change on "${target.name}" — provide newName and/or newDescription.`,
        };
      }

      await client.requestVoid("POST", `/lenses/${targetId}`, body);
      client.invalidateDefaultLens();

      const changed = [
        body.name != null ? `renamed to "${body.name}"` : null,
        body.description !== undefined ? "description updated" : null,
      ]
        .filter(Boolean)
        .join(", ");

      const after = await listWithActive(client);
      return {
        status: "edited",
        switched: false,
        edited: true,
        active_lens_id: after.active_lens_id,
        lenses: after.lenses,
        message: `"${target.name}" — ${changed}.`,
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
          edited: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `No lens with id ${targetId}. Pick an id from the list.`,
        };
      }
      if (target.is_active) {
        return {
          status: "switched",
          switched: false,
          edited: false,
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
        edited: false,
        active_lens_id: after.active_lens_id,
        lenses: after.lenses,
        message: `Now showing "${target.name}".`,
      };
    }

    // List path (pure read).
    const { lenses, active_lens_id } = await listWithActive(client);
    return { status: "listed", switched: false, edited: false, active_lens_id, lenses };
  },
};
