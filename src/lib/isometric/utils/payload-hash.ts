import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new TypeError("canonicalJson: value must not be undefined");
  }
  const json = JSON.stringify(canonicalize(value));
  if (json === undefined) {
    throw new TypeError("canonicalJson: value is not serializable");
  }
  return json;
}

export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

// Marker prefix used when fingerprinting functions inside hashed payloads.
// Plain JSON.stringify silently drops function values, which would let
// transform fns inside INPUT_MAPPING change without bumping MAPPING_REVISION.
// We serialise functions via their .toString() so any source-level change
// (including arrow-body or whitespace) flips the hash.
const FUNCTION_FINGERPRINT_PREFIX = "[Function]";

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalJson: non-finite number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "function") {
    return `${FUNCTION_FINGERPRINT_PREFIX}${(value as () => unknown).toString()}`;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}
