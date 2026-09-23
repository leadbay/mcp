/**
 * leadbay_manage_lenses — list the user's lenses, switch the active one, or rename one.
 *
 * Default-surface composite. With no args it is a pure read: GET /lenses,
 * merged with the active lens from /users/me.last_requested_lens (more
 * reliable than the payload's per-row is_last_active, which can be stale).
 *
 * - switchToLensId → POST /lenses/{id}/update_last_requested, invalidate caches,
 *   return the REFRESHED list with the new active marked.
 * - renameLensId + newName → POST /lenses/{id} {name}, return the refreshed list.
 *
 * Every returned list carries each lens's full metadata and its own criteria,
 * sectors and places by name: GET /lenses/{id}/filter per lens. The only
 * default-surface read of a lens's criteria — get_lens_filter is
 * advanced-gated and lens://{id}/definition is a resource most hosts never let
 * the model read (product#4176).
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
import type { Tool, ToolContext, LensPayload, FilterPayload } from "../types.js";
import { criteriaOf } from "./_empty-lens-reason.js";
import { fetchSectorTaxonomy, sectorLabel } from "./_sector-resolver.js";

import { leadbay_manage_lenses as MY_LENSES_DESCRIPTION } from "../tool-descriptions.generated.js";

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
  // null when this lens's filter could not be read.
  criteria: Array<Record<string, unknown>> | null;
  [k: string]: unknown;
}

// Normalize any id (string or number) to the string form the backend uses.
const sid = (v: string | number | null | undefined): string | null =>
  v == null ? null : String(v);

async function listWithActive(
  client: LeadbayClient,
  ctx?: ToolContext,
  // A list read earlier in this call. Switch, edit and delete never change a
  // filter, so its criteria are reused rather than read a second time.
  earlier?: LensListEntry[]
): Promise<{ lenses: LensListEntry[]; active_lens_id: string | null }> {
  const lenses = await client.request<LensPayload[]>("GET", "/lenses");
  // Prefer /me.last_requested_lens for active state; fall back to the per-row
  // is_last_active flag if /me is unavailable. Compare as strings.
  const me = await client.resolveMe().catch(() => null);
  const activeFromMe = sid(me?.last_requested_lens);
  const active_lens_id =
    activeFromMe ?? sid(lenses.find((l) => l.is_last_active)?.id) ?? null;

  const known = new Map(earlier?.map((l) => [l.id, l.criteria]));
  const unread = lenses.map((l) => sid(l.id) as string).filter((id) => !known.has(id));
  const read = await readLensCriteria(client, unread, ctx);

  return {
    active_lens_id,
    // Every field GET /lenses returns, except the two this replaces:
    // is_last_active (can be stale; is_active is resolved from /me) and
    // default (folded into is_default).
    lenses: lenses.map(({ is_last_active: _stale, default: _default, ...l }) => {
      const id = sid(l.id) as string;
      return {
        ...l,
        id,
        description: l.description ?? null,
        is_active: id === active_lens_id,
        is_default: l.is_default === true || _default === true,
        criteria: known.get(id) ?? read.get(id) ?? null,
      };
    }),
  };
}

/**
 * Each lens's own criteria as the web app shows them (`lens_filter`), each
 * criterion passed through whole with its sector and location ids named.
 * `implicit_filter` is left out: the web app never shows it and the user
 * cannot edit it. One filter read per lens, throttled by the client's
 * concurrency limit. Sector names come from one taxonomy read in the user's
 * language, made only when some lens has a sector criterion; locations are
 * named from each filter's own `locations.results`. An id with no match keeps
 * `name: null`. A lens whose filter cannot be read is left out of the map, so
 * one failing read never costs the user their list.
 */
async function readLensCriteria(
  client: LeadbayClient,
  lensIds: string[],
  ctx?: ToolContext
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const filters = await Promise.all(
    lensIds.map((id) =>
      client.request<FilterPayload>("GET", `/lenses/${id}/filter`).catch(() => null)
    )
  );

  const sectorNames = new Map<string, string>();
  if (filters.some((f) => f && criteriaOf(f).some((c) => c.type === "sector_ids"))) {
    const taxonomy = await fetchSectorTaxonomy(client, ctx).catch(() => []);
    for (const row of taxonomy) {
      const label = sectorLabel(row);
      if (label) sectorNames.set(String(row.id), label);
    }
  }

  const named = (ids: unknown, names: Map<string, string>) =>
    ((ids as string[] | undefined) ?? []).map((id) => ({ id, name: names.get(String(id)) ?? null }));
  const out = new Map<string, Array<Record<string, unknown>>>();
  filters.forEach((filter, i) => {
    if (!filter) return;
    const locationNames = new Map<string, string>();
    for (const r of (filter.locations?.results ?? []) as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof r.id === "string" && typeof r.name === "string") locationNames.set(r.id, r.name);
    }
    out.set(
      lensIds[i],
      criteriaOf(filter).map((c) => {
        if (c.type === "sector_ids") return { ...c, sectors: named(c.sectors, sectorNames) };
        if (c.type === "location_ids") return { ...c, locations: named(c.locations, locationNames) };
        return c;
      })
    );
  });
  return out;
}

export const myLenses: Tool<MyLensesParams> = {
  name: "leadbay_manage_lenses",
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
    openWorldHint: false,
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
          "'listed', 'switched', 'already_active', 'edited', 'deleted', 'delete_preview' (confirm to proceed), 'cannot_delete_default', or 'not_found'.",
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
        description:
          "The user's lenses, each with every field GET /lenses returns plus is_active, is_default and `criteria` (its sectors, locations and sizes by name; null if unreadable).",
        items: { type: "object" },
      },
      message: { type: "string" },
    },
    required: ["status", "lenses", "active_lens_id"],
  },
  execute: async (client: LeadbayClient, params: MyLensesParams, ctx?: ToolContext) => {
    // Delete path — destructive, so confirm-gated. Validate target, refuse the
    // default lens up front (backend rejects it anyway), preview unless confirmed.
    if (params.deleteLensId != null) {
      const targetId = sid(params.deleteLensId)!;
      const before = await listWithActive(client, ctx);
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

      const after = await listWithActive(client, ctx, before.lenses);
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
      const before = await listWithActive(client, ctx);
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

      const after = await listWithActive(client, ctx, before.lenses);
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
      const before = await listWithActive(client, ctx);
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
        // Honest no-op status: don't claim "switched" when nothing changed, so a
        // consumer keying on status doesn't announce a switch that didn't happen.
        return {
          status: "already_active",
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

      const after = await listWithActive(client, ctx, before.lenses);
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
    const { lenses, active_lens_id } = await listWithActive(client, ctx);
    return { status: "listed", switched: false, edited: false, active_lens_id, lenses };
  },
};
