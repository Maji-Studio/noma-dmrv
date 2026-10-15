import { OPERATION_MAX_ATTEMPTS, OPERATION_RETRY_MIN_DELAY_MS, OPERATION_RETRY_MAX_DELAY_MS } from "@/config/operations";
import { pgErrorCode, PG_DEADLOCK_DETECTED, PG_SERIALIZATION_FAILURE, PG_LOCK_NOT_AVAILABLE } from "@/db/errors";
import { DomainError } from "@/lib/domain-errors";

/** Classify a transaction abort, including driver errors wrapped by Drizzle. */
export function isRetryableTransactionError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === PG_DEADLOCK_DETECTED || code === PG_SERIALIZATION_FAILURE || code === PG_LOCK_NOT_AVAILABLE;
}

/** Backoff after a failed attempt; throws the shared concurrent_write_retry error once attempts are exhausted. */
export function nextRetryDelayOrThrow(attempt: number): number {
  if (attempt === OPERATION_MAX_ATTEMPTS) {
    throw new DomainError("concurrent_write_retry", "Concurrent changes prevented saving. Retry shortly.", { retryable: true });
  }
  return OPERATION_RETRY_MIN_DELAY_MS + Math.floor(
    Math.random() * (OPERATION_RETRY_MAX_DELAY_MS - OPERATION_RETRY_MIN_DELAY_MS + 1),
  );
}

/** Retry only callbacks owning a fresh transaction with no external effects. */
export async function retryTransaction<T>(transaction: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction();
    } catch (error) {
      if (!isRetryableTransactionError(error)) throw error;
      const delayMs = nextRetryDelayOrThrow(attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
