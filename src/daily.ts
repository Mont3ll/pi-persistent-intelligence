import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string): void {
  if (!DATE_RE.test(date)) throw new Error(`Invalid daily log date: ${date}`);
}

export function dailyLogPath(root: string, date: string): string {
  assertDate(date);
  const paths = ensureMemoryDirs(root);
  return join(paths.daily, `${date}.md`);
}

export function appendDailyLog(root: string, date: string, content: string): void {
  const file = dailyLogPath(root, date);
  const prefix = existsSync(file) && readFileSync(file, "utf-8").trim() ? "\n\n" : "";
  appendFileSync(file, `${prefix}${content.trim()}\n`, "utf-8");
}

export function readDailyLog(root: string, date: string): string {
  const file = dailyLogPath(root, date);
  return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

export function todayString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
