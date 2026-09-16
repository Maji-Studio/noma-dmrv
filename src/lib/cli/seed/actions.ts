import { ZodError } from "zod";
import type { ActionResult } from "@/types/actions";

/** Explicit seed diagnostics contain only safe action messages and stable IDs. */
export class SeedError extends Error {}

const DATABASE_ERROR_NAME = "DatabaseError";
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/** A driver error: its message can carry SQL text and row values. */
function isDatabaseError(error: Error): boolean {
  if (error.name === DATABASE_ERROR_NAME) return true;
  const candidate = error as { severity?: unknown; code?: unknown };
  if (typeof candidate.severity === "string") return true;
  return typeof candidate.code === "string" && SQLSTATE_PATTERN.test(candidate.code);
}

/**
 * A short, safe summary of a seed failure: error names, validation paths, and
 * authored messages only. Never SQL, environment values, row contents, or
 * stacks.
 */
export function describeSeedFailure(error: unknown): string {
  if (error instanceof SeedError) return error.message;
  if (error instanceof ZodError) {
    return [
      `${error.name}: input rejected by validation.`,
      ...error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`),
    ].join("\n");
  }
  if (error instanceof Error) {
    return isDatabaseError(error)
      ? `${error.name}. Check application diagnostics.`
      : `${error.name}: ${error.message}`;
  }
  return "Unknown failure. Check application diagnostics.";
}

/** Every action, including previews and reads, fails the seed at its named step. */
export async function unwrap<T>(step: string, result: Promise<ActionResult<T>>): Promise<T> {
  const resolved = await result;
  if (!resolved.success) throw new SeedError(`${step}: ${resolved.error}`);
  return resolved.data;
}

export class SeedCounts {
  private readonly counts = new Map<string, number>();

  add(entity: string, count = 1) {
    this.counts.set(entity, (this.counts.get(entity) ?? 0) + count);
  }

  print() {
    for (const [entity, count] of this.counts) console.log(`  ${entity}: ${count}`);
  }
}
