import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { canonicalJson } from "./canonical-json";
import type { BenchmarkManifest } from "./types";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprintManifest(manifest: BenchmarkManifest): string {
  return sha256Text(canonicalJson(manifest));
}

export async function sha256File(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
