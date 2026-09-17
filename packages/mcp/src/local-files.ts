// Files a LOCAL install hands to the user (product#4131). Only bin.ts, the
// stdio server running on the user's own machine, wires this into
// ToolContext.saveFile. The hosted server (http-server.ts) serves claude.ai,
// the Claude Desktop connector and ChatGPT from Leadbay's machine, where a
// file would never reach the user, so it passes nothing and tools write none.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Writes `content` to the user's Downloads folder, or to their home folder
 *  when there is no Downloads folder, and returns the absolute path. The
 *  name is reduced to its last segment, so it cannot point anywhere else. */
export async function saveToDownloads(
  name: string,
  content: string,
  home: string = homedir()
): Promise<string> {
  const downloads = join(home, "Downloads");
  const dir = existsSync(downloads) ? downloads : home;
  const path = join(dir, basename(name));
  await writeFile(path, content, "utf8");
  return path;
}
