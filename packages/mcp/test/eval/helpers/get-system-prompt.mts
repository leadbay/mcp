/**
 * Combined system prompt loader for eval sessions.
 *
 * Returns: MCP prompt body + server instructions concatenated.
 * This matches what real users receive: the Claude client gets both the MCP
 * server `instructions` field AND the slash-command prompt body when a prompt
 * is invoked. The eval harness uses --system-prompt which bypasses the MCP
 * protocol instructions field, so this script merges them manually.
 *
 * Usage: tsx get-system-prompt.mts <promptName>
 *   e.g. tsx get-system-prompt.mts leadbay_daily_check_in
 *
 * Outputs the combined text to stdout (no trailing newline beyond content).
 * Exits non-zero and writes error to stderr on failure.
 */
import { getPrompt } from "../../../src/prompts.js";
import { buildServerInstructions } from "../../../src/server.js";
import { compositeReadTools, compositeWriteTools, agentMemoryTools } from "@leadbay/core";

const promptName = process.argv[2];
if (!promptName) {
  process.stderr.write("Usage: tsx get-system-prompt.mts <promptName>\n");
  process.exit(1);
}

// Build the same exposed tool set as the live eval server:
// includeWrite=true, includeAdvanced=false, no updateStateStore (no acknowledge_update)
const exposedNames = new Set<string>();
for (const t of [...agentMemoryTools, ...compositeReadTools, ...compositeWriteTools]) {
  exposedNames.add(t.name);
}

let rendered;
try {
  rendered = getPrompt(promptName, {});
} catch (e) {
  process.stderr.write(`get-system-prompt: unknown prompt "${promptName}"\n`);
  process.exit(1);
}

const block = rendered.messages[0]?.content;
const promptBody = block?.type === "text"
  ? block.text
  : Array.isArray(block)
    ? (block.find((b: any) => b.type === "text")?.text ?? "")
    : "";

if (!promptBody || promptBody.length < 50) {
  process.stderr.write(`get-system-prompt: prompt body too short (${promptBody.length} chars)\n`);
  process.exit(1);
}

const serverInstructions = buildServerInstructions(exposedNames);

// Prompt body first, then server instructions — same order as real user context
// (prompt takes routing priority; server instructions add gate/widget context)
const combined = promptBody + "\n\n" + serverInstructions;
process.stdout.write(combined);
