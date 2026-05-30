import { formatInstallOsLabel, type DetectedClient } from "./install-shared.js";

function ansi(text: string, code: string, enabled: boolean): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function parseInstallSelection(input: string, clientCount: number): number[] | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "" || normalized === "a" || normalized === "all") {
    return Array.from({ length: clientCount }, (_, i) => i);
  }
  if (normalized === "n" || normalized === "none" || normalized === "q" || normalized === "quit") {
    return [];
  }

  const selected = new Set<number>();
  for (const part of normalized.split(/[\s,]+/).filter(Boolean)) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > clientCount) return null;
    selected.add(n - 1);
  }
  return [...selected].sort((a, b) => a - b);
}

export function updateInstallWizardState(
  key: string,
  cursor: number,
  selected: boolean[]
): { cursor: number; selected: boolean[]; done: boolean; cancel: boolean } {
  const count = selected.length;
  if (key === "" || key === "q") return { cursor, selected, done: false, cancel: true };
  if (key === "\r" || key === "\n") return { cursor, selected, done: true, cancel: false };
  if (key === "\x1B[A" || key === "k") {
    return { cursor: (cursor - 1 + count) % count, selected, done: false, cancel: false };
  }
  if (key === "\x1B[B" || key === "j") {
    return { cursor: (cursor + 1) % count, selected, done: false, cancel: false };
  }
  if (key === " ") {
    const next = [...selected];
    next[cursor] = !next[cursor];
    return { cursor, selected: next, done: false, cancel: false };
  }
  if (key === "a") return { cursor, selected: selected.map(() => true), done: false, cancel: false };
  if (key === "n") return { cursor, selected: selected.map(() => false), done: false, cancel: false };
  return { cursor, selected, done: false, cancel: false };
}

export async function readChoice(prompt: string, def = true): Promise<boolean> {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (!isTTY) return def;
  process.stderr.write(`${prompt} ${def ? "[Y/n]" : "[y/N]"} `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise<boolean>((resolve) => {
    const onData = (k: string) => {
      if (k === "\r" || k === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(def ? "y\n" : "n\n");
        return resolve(def);
      }
      if (k === "\u0003" || k === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        process.exit(130);
      }
      const lower = k.toLowerCase();
      if (lower === "y" || lower === "n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(`${lower}\n`);
        return resolve(lower === "y");
      }
    };
    process.stdin.on("data", onData);
  });
}

export function renderInstallWizard(
  osLabel: string,
  clients: DetectedClient[],
  cursor: number,
  selected: boolean[],
  useColor: boolean
): string {
  const lines = [
    ansi("Leadbay MCP installer", "1;36", useColor),
    `OS: ${osLabel}`,
    ansi("Arrows move, Space selects, Enter confirms", "2", useColor),
    "",
  ];
  clients.forEach((client, index) => {
    const active = index === cursor;
    const checked = selected[index];
    const pointer = active ? ansi(">", "36", useColor) : " ";
    const box = checked ? ansi("[x]", "32", useColor) : "[ ]";
    const label = active ? ansi(client.label, "1", useColor) : client.label;
    lines.push(`${pointer} ${box} ${label.padEnd(16)} ${client.detail}`);
  });
  return `${lines.join("\n")}\n`;
}

export async function chooseInstallClients(clients: DetectedClient[]): Promise<DetectedClient[]> {
  const stdin = process.stdin;
  const useColor = process.stderr.isTTY === true && process.env.NO_COLOR !== "1";
  let cursor = 0;
  let selected = clients.map(() => true);

  const render = () => {
    process.stderr.write("\x1b[2J\x1b[H");
    process.stderr.write(renderInstallWizard(formatInstallOsLabel(), clients, cursor, selected, useColor));
  };

  process.stderr.write("\x1b[?25l");
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  render();

  return await new Promise<DetectedClient[]>((resolve) => {
    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\x1b[?25h");
    };
    const onData = (key: string) => {
      const next = updateInstallWizardState(key, cursor, selected);
      cursor = next.cursor;
      selected = next.selected;
      if (next.cancel) {
        cleanup();
        process.stderr.write("\n");
        process.exit(130);
      }
      if (next.done) {
        cleanup();
        process.stderr.write("\n");
        resolve(clients.filter((_, index) => selected[index]));
        return;
      }
      render();
    };
    stdin.on("data", onData);
  });
}
