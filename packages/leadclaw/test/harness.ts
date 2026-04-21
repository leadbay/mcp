/**
 * Test harness for the OpenClaw adapter.
 *
 * Unlike the protocol-agnostic core tests, adapter tests need to verify the
 * OpenClaw-shaped API surface: how `register(api)` invokes `api.registerTool`,
 * how logs/token-preconfigure behavior are observed, etc.
 */

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  optional?: boolean;
  execute: (id: string, params: unknown) => unknown | Promise<unknown>;
}

export interface TestApi {
  api: {
    pluginConfig: Record<string, unknown>;
    logger: {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
    };
    registerTool: (tool: RegisteredTool) => void;
  };
  tools: Map<string, RegisteredTool>;
  logs: { level: "info" | "warn" | "error"; msg: string }[];
}

export function createTestApi(pluginConfig: Record<string, unknown> = {}): TestApi {
  const tools = new Map<string, RegisteredTool>();
  const logs: { level: "info" | "warn" | "error"; msg: string }[] = [];
  const api = {
    pluginConfig,
    logger: {
      info: (msg: string) => logs.push({ level: "info", msg }),
      warn: (msg: string) => logs.push({ level: "warn", msg }),
      error: (msg: string) => logs.push({ level: "error", msg }),
    },
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
  };
  return { api, tools, logs };
}
