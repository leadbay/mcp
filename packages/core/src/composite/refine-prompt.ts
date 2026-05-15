import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, ClarificationPayload } from "../types.js";

import { leadbay_refine_prompt as REFINE_PROMPT_DESCRIPTION } from "../tool-descriptions.generated.js";
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
  annotations: {
    title: "Refine the audience prompt",
    readOnlyHint: false,
    destructiveHint: true,
    // Sets the org's user_prompt and may trigger a clarification flow. Each
    // call replaces the prior prompt — a second call with a different
    // instruction is NOT idempotent (the second prompt wins).
    idempotentHint: false,
    openWorldHint: true,
  },
  description: REFINE_PROMPT_DESCRIPTION,
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
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Multiple return shapes by status. dry_run, applied (with optional clarified_via_elicit), or clarification_pending.",
    properties: {
      dry_run: { type: "boolean", description: "True when dry_run:true was passed (no state change)." },
      would_call: {
        type: "object",
        description: "Dry-run preview of the POST that would have been issued.",
      },
      status: {
        type: "string",
        description: "'applied' (prompt set; intelligence regenerating) or 'clarification_pending' (telephone path).",
      },
      computing_intelligence: {
        type: "boolean",
        description: "True when intelligence is regenerating after the prompt set.",
      },
      clarified_via_elicit: {
        type: "boolean",
        description: "True when the clarification was answered via the client's elicitation UI (not via telephone).",
      },
      message: {
        type: "string",
        description: "Operator-facing summary.",
      },
      clarification: {
        type: "object",
        description: "ClarificationPayload returned by the backend (clarification_pending path).",
      },
      next_action: {
        type: "string",
        description: "Concrete next-step instruction for the agent.",
      },
      _meta: { type: "object" },
    },
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
      // Iter 14 (per second-opinion #2): if the client supports
      // elicitation, ask the user the clarification directly via
      // elicitation/create — the spec's "no telephone" pattern. The
      // server pulls the answer and POSTs to /pick_clarification, then
      // returns "applied" without bouncing through the agent.
      if (ctx?.elicit) {
        const opts = clarification.options ?? [];
        const requestedSchema =
          opts.length > 0
            ? {
                type: "object",
                properties: {
                  option_id: {
                    type: "string",
                    title: "Pick one",
                    description: "Choose the option that best matches your intent.",
                    enum: opts
                      .filter((o) => o.id)
                      .map((o) => o.id as string),
                    enumNames: opts
                      .filter((o) => o.id)
                      .map((o) => o.label),
                  },
                },
                required: ["option_id"],
              }
            : {
                type: "object",
                properties: {
                  text_answer: {
                    type: "string",
                    title: "Answer",
                    description:
                      "Free-text answer to the clarification. Plain English.",
                  },
                },
                required: ["text_answer"],
              };
        try {
          const elicited = await ctx.elicit({
            message: clarification.question,
            requestedSchema,
          });
          if (elicited.action === "accept" && elicited.content) {
            const body =
              typeof elicited.content.option_id === "string"
                ? { option_id: elicited.content.option_id }
                : typeof elicited.content.text_answer === "string"
                ? { text_answer: elicited.content.text_answer }
                : null;
            if (body) {
              try {
                await client.requestVoid(
                  "POST",
                  `/organizations/${orgId}/pick_clarification`,
                  body
                );
                client.invalidateMe();
                return {
                  status: "applied",
                  clarified_via_elicit: true,
                  computing_intelligence: true,
                  message:
                    "Prompt set + clarification answered via the client's elicitation UI. Leadbay is regenerating intelligence.",
                  _meta: { region: client.region },
                };
              } catch (err: any) {
                ctx?.logger?.warn?.(
                  `refine_prompt: pick_clarification POST failed after elicit: ${err?.message ?? err?.code ?? err}`
                );
                // Fall through to telephone path; let the agent retry via
                // answer_clarification.
              }
            }
          }
          // action=decline or cancel: surface to the agent so it can
          // ask the user another way (or abandon).
        } catch (err: any) {
          ctx?.logger?.warn?.(
            `refine_prompt: elicit failed: ${err?.message ?? err?.code ?? err} — falling back to telephone path`
          );
        }
      }
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
