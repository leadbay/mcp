import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, ClarificationPayload } from "../types.js";

interface RefinePromptParams {
  prompt: string;
  clarification_poll_attempts?: number;
  clarification_poll_gap_ms?: number;
  dry_run?: boolean;
}

const DEFAULT_POLL_ATTEMPTS = 2;
const DEFAULT_POLL_GAP_MS = 5_000;

export const refinePrompt: Tool<RefinePromptParams> = {
  name: "leadbay_refine_prompt",
  description:
    "Refine the kind of leads Leadbay surfaces, beyond firmographics. Free-text instruction (e.g. 'focus on " +
    "hospitals running their own IT'). Sets the org's user_prompt; if the new prompt produces ambiguous criteria, " +
    "Leadbay raises a clarification question, which this composite polls for and surfaces. Admin-only on the " +
    "backend (will return 403 for non-admins). " +
    "When to use: when audience filters (leadbay_adjust_audience) aren't enough. " +
    "When NOT to use: to answer a pending clarification — that's leadbay_answer_clarification.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Refinement instruction (free text)" },
      clarification_poll_attempts: {
        type: "number",
        description: `How many times to poll for a clarification after setting (default ${DEFAULT_POLL_ATTEMPTS})`,
      },
      clarification_poll_gap_ms: {
        type: "number",
        description: `Gap between polls in ms (default ${DEFAULT_POLL_GAP_MS})`,
      },
      dry_run: {
        type: "boolean",
        description: "If true, return the call shape WITHOUT setting the prompt",
      },
    },
    required: ["prompt"],
  },
  execute: async (
    client: LeadbayClient,
    params: RefinePromptParams,
    ctx?: ToolContext
  ) => {
    const me = await client.resolveMe();
    if (me.admin !== true) {
      return {
        error: true,
        code: "FORBIDDEN",
        message: "leadbay_refine_prompt requires admin rights on the org",
        hint:
          "Ask your Leadbay org admin to set the refinement prompt, or use leadbay_adjust_audience for firmographic changes",
      };
    }

    const orgId = me.organization.id;
    if (params.dry_run) {
      return {
        dry_run: true,
        would_call: {
          method: "POST",
          path: `/organizations/${orgId}/user_prompt`,
          body: { user_prompt: params.prompt },
        },
      };
    }

    // Capture POST timestamp — used to discriminate stale clarifications from
    // fresh ones produced by THIS prompt's regeneration.
    const postedAt = Date.now();
    const STALE_GUARD_MS = 5_000;

    await client.requestVoid("POST", `/organizations/${orgId}/user_prompt`, {
      user_prompt: params.prompt,
    });

    // Cache invalidation — /me's computing_intelligence flag is now true.
    client.invalidateMe();

    const attempts = params.clarification_poll_attempts ?? DEFAULT_POLL_ATTEMPTS;
    const gap = params.clarification_poll_gap_ms ?? DEFAULT_POLL_GAP_MS;
    let clarification: ClarificationPayload | null = null;

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, gap));
      try {
        const c = await client.request<ClarificationPayload | null>(
          "GET",
          `/organizations/${orgId}/clarifications`
        );
        if (c) {
          // Stale-guard: if created_at predates our POST by more than the
          // small clock-skew window, treat it as stale and keep polling.
          if (c.created_at) {
            const createdMs = Date.parse(c.created_at);
            if (Number.isFinite(createdMs) && createdMs < postedAt - STALE_GUARD_MS) {
              ctx?.logger?.warn?.(
                `refine_prompt: stale clarification (created_at=${c.created_at}, posted=${new Date(postedAt).toISOString()}) — ignoring`
              );
              continue;
            }
          }
          clarification = c;
          break;
        }
      } catch (err: any) {
        ctx?.logger?.warn?.(
          `refine_prompt: clarification poll error: ${err?.message}`
        );
      }
    }

    if (clarification) {
      return {
        status: "clarification_pending",
        clarification,
        next_action:
          "Call leadbay_answer_clarification with option_id (preferred) or text_answer to disambiguate",
        _meta: { region: client.region },
      };
    }

    return {
      status: "applied",
      computing_intelligence: true,
      message:
        "Prompt set. Leadbay is regenerating intelligence; new leads will reflect the refinement shortly. " +
        "Check leadbay_account_status to monitor computing_intelligence.",
      _meta: { region: client.region },
    };
  },
};
