import { createHash } from "node:crypto";

/** SHA-256 hex digest for lookup keys. Callers own serialization and prefixes. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
