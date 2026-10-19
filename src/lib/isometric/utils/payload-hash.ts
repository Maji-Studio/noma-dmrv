import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonical-json";

export { canonicalJson };

export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
