import type { CommandUiContext } from "./types";

export function parseCommandArgs(input: string): { positional: string[]; flags: Record<string, string | boolean> } {
  const tokens = [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = tokens[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

export function wantsPlainOutput(args: string): boolean {
  const { flags } = parseCommandArgs(args);
  return flags.plain === true || flags.json === true || flags.yaml === true || flags.interactive === false;
}

export function notifyStructured(
  context: CommandUiContext,
  args: string,
  value: unknown,
  plain: string,
  kind = "info",
): void {
  const { flags } = parseCommandArgs(args);
  context.ui.notify(flags.json === true ? JSON.stringify(value, null, 2) : plain, kind);
}
