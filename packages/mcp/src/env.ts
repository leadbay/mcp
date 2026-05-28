// Shared environment parsing for MCP entrypoints. Keep this file side-effect free.

export function parseWriteEnv(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.LEADBAY_MCP_WRITE;
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  process.stderr.write(
    "[leadbay-mcp warn] LEADBAY_MCP_WRITE not recognized; defaulting to ON. Use 1/0.\n"
  );
  return true;
}
