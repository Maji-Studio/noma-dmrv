import type { ActionResult } from "@/types/actions";

/** Explicit seed diagnostics contain only safe action messages and stable IDs. */
export class SeedError extends Error {}

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
