import { DomainError, type DomainErrorCode } from "@/lib/domain-errors";
import { ActionConflictError, SafeError } from "@/lib/errors";

/** Legacy feedstock guards are safe errors; expose their typed domain outcome. */
export async function withFeedstockErrors<T>(work: () => Promise<T>, code: DomainErrorCode = "validation_failed", path?: (string | number)[]): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error instanceof ActionConflictError) {
      throw new DomainError("conflict", error.message, { conflict: error.conflict, blockers: error.blockers });
    }
    if (error instanceof SafeError) {
      const failure = new DomainError(code, error.message, {
        issues: path ? [{ path, code, message: error.message }] : undefined,
      });
      // The guard already normalized this operator message through SafeError.
      failure.message = error.message;
      throw failure;
    }
    throw error;
  }
}
