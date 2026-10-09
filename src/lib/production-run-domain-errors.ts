import { StockOverdrawError } from "@/data-access/stock-overdraw-error";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError, SafeError } from "@/lib/errors";

/** Preserve operator-safe guard messages across the runner boundary. */
export async function withProductionRunErrors<T>(
  work: () => Promise<T>,
  path?: (string | number)[],
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error instanceof StockOverdrawError && error.details) {
      throw new DomainError("insufficient_stock", error.message, {
        issues: [{ path: path ?? ["feedstockDraws"], code: "insufficient_stock", message: error.message,
          meta: { ...error.details, unit: "kg" } }],
      });
    }
    if (error instanceof ActionConflictError) {
      throw new DomainError("conflict", error.message, { conflict: error.conflict, blockers: error.blockers });
    }
    if (error instanceof SafeError) {
      const failure = new DomainError("validation_failed", error.message, {
        issues: path ? [{ path, code: "validation_failed", message: error.message }] : undefined,
      });
      failure.message = error.message;
      throw failure;
    }
    throw error;
  }
}

export function productionRunValidationError(message: string, path: (string | number)[]): DomainError {
  return new DomainError("validation_failed", message, {
    issues: [{ path, code: "validation_failed", message: new SafeError(message).message }],
  });
}

export function runReferenceNotFound(message: string, path?: (string | number)[]) {
  return new DomainError("not_found", message, {
    issues: path ? [{ path, code: "not_found", message }] : undefined,
  });
}
