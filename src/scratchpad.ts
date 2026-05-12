import { readFileSync, writeFileSync } from "node:fs";
import { ensureMemoryDirs } from "./paths";

export interface ScratchpadItem {
  done: boolean;
  text: string;
}

export function parseScratchpad(content: string): ScratchpadItem[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^- \[([ xX])\] (.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ done: match[1].toLowerCase() === "x", text: match[2] }));
}

export function serializeScratchpad(items: ScratchpadItem[]): string {
  return ["# Scratchpad", "", ...items.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`), ""].join("\n");
}

export function listScratchpadItems(root: string): ScratchpadItem[] {
  const paths = ensureMemoryDirs(root);
  return parseScratchpad(readFileSync(paths.scratchpad, "utf-8"));
}

function writeItems(root: string, items: ScratchpadItem[]): void {
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.scratchpad, serializeScratchpad(items), "utf-8");
}

export function addScratchpadItem(root: string, text: string): ScratchpadItem[] {
  const items = listScratchpadItems(root);
  items.push({ done: false, text });
  writeItems(root, items);
  return items;
}

function updateMatch(root: string, matchText: string, done: boolean): ScratchpadItem[] {
  const items = listScratchpadItems(root);
  const item = items.find((entry) => entry.text.includes(matchText));
  if (!item) throw new Error(`Scratchpad item not found: ${matchText}`);
  item.done = done;
  writeItems(root, items);
  return items;
}

export function markScratchpadDone(root: string, matchText: string): ScratchpadItem[] {
  return updateMatch(root, matchText, true);
}

export function markScratchpadUndone(root: string, matchText: string): ScratchpadItem[] {
  return updateMatch(root, matchText, false);
}

export function clearDoneScratchpadItems(root: string): ScratchpadItem[] {
  const items = listScratchpadItems(root).filter((item) => !item.done);
  writeItems(root, items);
  return items;
}
