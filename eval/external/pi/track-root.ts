import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkTrack } from "../core/types";

export function claimTrackRoot(root: string, track: BenchmarkTrack): void {
  mkdirSync(root, { recursive: true }); const marker = join(root, ".benchmark-track.json");
  if (existsSync(marker)) {
    const current = JSON.parse(readFileSync(marker, "utf8")) as { track?: string };
    if (current.track !== track) throw new Error(`benchmark root already assigned to ${current.track ?? "another track"}`);
    return;
  }
  writeFileSync(marker, `${JSON.stringify({ schemaVersion: 1, track })}\n`, { flag: "wx", mode: 0o600 });
}
