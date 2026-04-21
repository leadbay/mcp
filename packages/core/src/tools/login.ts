import https from "node:https";
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

function httpsPost(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

interface LoginParams {
  email: string;
  password: string;
}

export const login: Tool<LoginParams> = {
  name: "leadbay_login",
  description:
    "Log in to Leadbay with email and password. Must be called before using any other Leadbay tool. The user needs a Leadbay account — they can register at https://wow.leadbay.ai/?register=true",
  inputSchema: {
    type: "object",
    properties: {
      email: {
        type: "string",
        description: "Leadbay account email address",
      },
      password: {
        type: "string",
        description: "Leadbay account password",
      },
    },
    required: ["email", "password"],
  },
  execute: async (client: LeadbayClient, params: LoginParams, ctx?: ToolContext) => {
    // Some LLMs backslash-escape special characters in tool call JSON
    // (e.g. "Password1\!" instead of "Password1!"). Strip spurious escapes.
    const cleanPassword = params.password.replace(/\\(.)/g, "$1");
    const payload = JSON.stringify({
      email: params.email,
      password: cleanPassword,
    });
    ctx?.logger?.info?.(`LeadClaw login: email=${params.email} baseUrl=${client.baseUrl}`);

    let result: { status: number; body: string };
    try {
      result = await httpsPost(`${client.baseUrl}/1.5/auth/login`, payload);
    } catch (err: any) {
      ctx?.logger?.error?.(`LeadClaw login: request error: ${err?.message}`);
      return {
        error: true,
        code: "NETWORK_ERROR",
        message: `Network error: ${err?.message}`,
        hint: "Check your internet connection",
      };
    }

    ctx?.logger?.info?.(`LeadClaw login: status=${result.status}`);

    if (result.status < 200 || result.status >= 300) {
      ctx?.logger?.error?.(`LeadClaw login: error: ${result.body}`);
      let msg = "Login failed";
      try {
        const parsed = JSON.parse(result.body);
        msg = parsed.message || parsed.error?.message || parsed.error || msg;
      } catch {}
      return {
        error: true,
        code: "LOGIN_FAILED",
        message: msg,
        hint: "Check your email and password. Need an account? Register at https://wow.leadbay.ai/?register=true",
      };
    }

    const data = JSON.parse(result.body);
    client.setToken(data.token);

    // Prefetch org data now that we're authenticated
    client.prefetchOrgData().catch(() => {});

    return {
      success: true,
      message: "Logged in to Leadbay successfully",
    };
  },
};
