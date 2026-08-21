function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON requires finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  if (typeof value !== "object") throw new Error(`Canonical JSON contains unsupported ${typeof value} value`);
  if (seen.has(value)) throw new Error("Canonical JSON does not support cyclic objects");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Canonical JSON supports plain objects only");
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    output[key] = normalize((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(value);
  return output;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}
