import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonl<T = unknown>(file: string): T[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function writeJsonl<T>(file: string, records: T[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(file, content ? `${content}\n` : "", "utf-8");
}

export function appendJsonl<T>(file: string, record: T): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf-8");
}
