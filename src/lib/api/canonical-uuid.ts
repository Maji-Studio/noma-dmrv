import { uuidSchema } from "@/schemas/helpers";

const canonicalUuidSchema = uuidSchema();

/**
 * A path segment or tool target as a canonical lowercase UUID, or undefined
 * when it is not one, which callers answer as not found. Writes key their
 * idempotency target, reads and stale-version answers on it, so either case
 * names one resource.
 */
export function canonicalUuid(value: string): string | undefined {
  const parsed = canonicalUuidSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
