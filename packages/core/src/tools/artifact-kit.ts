import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_artifact_kit as ARTIFACT_KIT_DESCRIPTION } from "../tool-descriptions.generated.js";
import {
  ARTIFACT_RUNTIME,
  ARTIFACT_USAGE_GUIDE,
  ARTIFACT_KIT_VERSION,
} from "../artifact-runtime.generated.js";

// leadbay_artifact_kit hands the agent everything to BUILD an interactive HTML
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
  // No input — the kit is the same for every caller.
}

export const artifactKit: Tool<ArtifactKitParams> = {
  name: "leadbay_artifact_kit",
  annotations: {
    title: "Artifact component kit",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: ARTIFACT_KIT_DESCRIPTION,
  write: false,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  // No outputSchema by design: the return is three opaque strings. Declaring a
  // schema would enroll the tool in the output-schema-conformance drift-catcher
  // (an existing test file we don't modify). The server still emits the
  // plain-object return as structuredContent: { runtime, usage_guide, version }.
  execute: async (
    _client: LeadbayClient,
    _params: ArtifactKitParams,
    _ctx?: ToolContext,
  ) => {
    return {
      version: ARTIFACT_KIT_VERSION,
      runtime: ARTIFACT_RUNTIME,
      usage_guide: ARTIFACT_USAGE_GUIDE,
    };
  },
};
