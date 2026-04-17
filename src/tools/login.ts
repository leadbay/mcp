import type { LeadbayClient } from "../client.js";

export function registerLogin(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_login",
    description:
      "Log in to Leadbay with email and password. Must be called before using any other Leadbay tool. The user needs a Leadbay account — they can register at https://wow.leadbay.ai/?register=true",
    parameters: {
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
    execute: async (params: { email: string; password: string }) => {
      const res = await fetch(`${client.baseUrl}/1.5/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email,
          password: params.password,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = "Login failed";
        try {
          const parsed = JSON.parse(text);
          msg = parsed.message || parsed.error || msg;
        } catch {}
        return {
          error: true,
          code: "LOGIN_FAILED",
          message: msg,
          hint: "Check your email and password. Need an account? Register at https://wow.leadbay.ai/?register=true",
        };
      }

      const data = await res.json();
      client.setToken(data.token);

      // Prefetch org data now that we're authenticated
      client.prefetchOrgData().catch(() => {});

      return {
        success: true,
        message: "Logged in to Leadbay successfully",
      };
    },
  });
}
