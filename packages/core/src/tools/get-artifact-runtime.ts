import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_get_artifact_runtime as ARTIFACT_KIT_DESCRIPTION } from "../tool-descriptions.generated.js";
import {
  ARTIFACT_RUNTIME,
  ARTIFACT_USAGE_GUIDE,
  ARTIFACT_KIT_VERSION,
} from "../artifact-runtime.generated.js";
import { ARTIFACT_TEMPLATES } from "../artifact-templates.generated.js";

// A template is a FINISHED board: the page every user who asks for it gets,
// identical to the one that was approved. The agent publishes `html` as it
// is — the only permitted edit is the JSON config block, when the template
// has one. A recipe re-implemented per agent drifts; a template cannot.
export const TEMPLATE_NAMES = Object.keys(ARTIFACT_TEMPLATES);

// leadbay_get_artifact_runtime hands the agent everything to BUILD an interactive HTML
// artifact (the user's cowork surface): the headless `@leadbay/components`
// runtime string + a markdown usage guide. It makes no backend call and mutates
// nothing — it returns static, version-locked content emitted by
// @leadbay/components' build (see packages/core/src/artifact-runtime.generated.ts).
//
// Lives in tools/ (granular-shaped: static relay, no orchestration) so it stays
// OUT of COMPOSITE_FILE_TOOL_NAMES and does not carry the `_triggered_by`
// mandate for a kit fetch. Registered in compositeReadTools so it's always
// exposed, even in read-only deployments.

export interface ArtifactKitParams {
  template?: string;
}

export const artifactKit: Tool<ArtifactKitParams> = {
  name: "leadbay_get_artifact_runtime",
  annotations: {
    title: "Artifact component kit",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: ARTIFACT_KIT_DESCRIPTION,
  outputSchema: {
    type: "object",
    properties: {
      version: { type: "string", description: "Kit version; bump means the runtime changed." },
      runtime: { type: "string", description: "The self-contained JS the artifact inlines. Absent when a template is returned." },
      usage_guide: { type: "string", description: "Markdown guide for building the artifact. Absent when a template is returned." },
      template: { type: "string", description: "The template returned, when one was asked for." },
      title: { type: "string", description: "The artifact's title (it is also the page's <title>)." },
      icon: { type: "string", description: "The artifact's icon word." },
      description: { type: "string", description: "One sentence for the artifact's gallery card." },
      html: { type: "string", description: "The finished page. Publish it as it is." },
      capabilities: { type: "object", description: "The capability declaration to publish the page with." },
      instructions: { type: "string", description: "How to publish the template." },
      // buildServer injects _meta.update_available / _meta.notifications into
      // successful object results before emitting structuredContent, so it is a
      // real top-level key at runtime even though execute() never writes it.
      _meta: { type: "object", description: "Server-injected notices, when present." },
    },
    required: ["version"],
  },
  write: false,
  inputSchema: {
    type: "object",
    properties: {
      template: {
        type: "string",
        enum: TEMPLATE_NAMES,
        description:
          "A finished board to publish as it is: \"route_planner\" (follow-ups on a map) or \"triage_board\" (today's leads as cards). Omit to get the runtime and usage guide for building a custom page.",
      },
    },
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: ArtifactKitParams,
    _ctx?: ToolContext,
  ) => {
    if (params && params.template) {
      const t = ARTIFACT_TEMPLATES[params.template];
      if (!t) {
        throw client.makeError(
          "UNKNOWN_TEMPLATE",
          `Unknown template: ${params.template}`,
          `Use one of: ${TEMPLATE_NAMES.join(", ")}.`,
        );
      }
      return {
        version: ARTIFACT_KIT_VERSION,
        template: params.template,
        title: t.title,
        icon: t.icon,
        description: t.description,
        html: t.html,
        capabilities: { mcp: { servers: [{ server: "Leadbay", tools: t.tools }] } },
        instructions:
          "Publish `html` AS IT IS, as a new artifact, with `capabilities`, `icon` and `description` from this result. " +
          "Do not restyle, rewrite or trim it: this page is the board every user gets. " +
          (t.html.includes('id="lb-board-config"')
            ? "The ONE edit allowed is the JSON inside <script id=\"lb-board-config\">: set \"city\" to where the rep is going (never a country), or leave it \"\". "
            : "") +
          "The page loads its own data through the Leadbay connector when it opens.",
      };
    }
    return {
      version: ARTIFACT_KIT_VERSION,
      runtime: ARTIFACT_RUNTIME,
      usage_guide: ARTIFACT_USAGE_GUIDE,
    };
  },
};
