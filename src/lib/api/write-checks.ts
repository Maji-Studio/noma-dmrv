import { deadlineExceeded, DomainError } from "@/lib/domain-errors";
import { ApiHttpError } from "./http-error";

export function remainingDeadlineMs(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw deadlineExceeded("before starting");
  return remaining;
}

export async function withCurrentOnStale<T>(
  fn: () => Promise<T>,
  { noun, readCurrent }: { noun: string; readCurrent: () => Promise<unknown> },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readCurrent();
      throw new ApiHttpError(412, "stale_version", `The ${noun} has changed. Read the current representation before retrying.`, current);
    }
    throw error;
  }
}
