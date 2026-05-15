import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { resolveRegion, REGIONS } from "../client.js";
import { leadbay_login as LOGIN_DESCRIPTION } from "../tool-descriptions.generated.js";

interface LoginParams {
  email: string;
  password: string;
}

export const login: Tool<LoginParams> = {
  name: "leadbay_login",
  annotations: {
    title: "Mint a Leadbay bearer token",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: LOGIN_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Leadbay account email address" },
      password: { type: "string", description: "Leadbay account password" },
    },
    required: ["email", "password"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: LoginParams,
    ctx?: ToolContext
  ) => {
    // Some LLMs backslash-escape special characters in tool call JSON
    // (e.g. "secret\!" instead of "secret!"). Strip spurious escapes.
    const cleanPassword = params.password.replace(/\\(.)/g, "$1");

    const startWith =
      client.region === "fr" ? "fr" : "us";
    ctx?.logger?.info?.(
      `LeadClaw login: email=${params.email} startRegion=${startWith}`
    );

    try {
      const result = await resolveRegion(
        params.email,
        cleanPassword,
        startWith
      );

      // Switch the client to the working region (clears tenant-scoped caches)
      // if it differs from the constructed one.
      if (client.baseUrl !== result.baseUrl) {
        client.setBaseUrl(result.baseUrl, result.region);
        ctx?.logger?.info?.(
          `LeadClaw login: switched to region=${result.region} (account is in the ${result.region.toUpperCase()} backend)`
        );
      }
      client.setToken(result.token);

      // Prefetch org data now that we're authenticated
      client.prefetchOrgData().catch(() => {});

      return {
        success: true,
        message: `Logged in to Leadbay (${result.region.toUpperCase()})`,
        region: result.region,
        verified: result.verified,
      };
    } catch (err: any) {
      ctx?.logger?.error?.(`LeadClaw login: failed: ${err?.message}`);
      return {
        error: true,
        code: "LOGIN_FAILED",
        message: err?.message || "Login failed in both regions",
        hint:
          "Check your email and password. The auto-detect tried both " +
          `${REGIONS.us} and ${REGIONS.fr}. Need an account? Register at https://wow.leadbay.ai/?register=true`,
      };
    }
  },
};
