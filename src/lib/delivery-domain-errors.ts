import { DomainError, type DomainErrorCode, type DomainIssue } from "./domain-errors";
import { SafeError } from "./errors";
import { deliveryOrderBalanceMessage } from "./delivery-order-balance";

function refusal(code: DomainErrorCode, path: DomainIssue["path"], message: string, meta?: DomainIssue["meta"]): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError(code, detail, { issues: [{ path, code, message: detail, ...(meta ? { meta } : {}) }] });
}

export function deliveryReferenceNotFound(path: DomainIssue["path"], label: string): DomainError {
  return refusal("not_found", path, `${label} was not found.`);
}

export function deliveryValidationFailed(path: DomainIssue["path"], message: string): DomainError {
  return refusal("validation_failed", path, message);
}

export function deliveryBalanceExceeded(availableWetKg: number, requestedWetKg: number): DomainError {
  return refusal("conflict", ["deliveredWetMassKg"], deliveryOrderBalanceMessage(availableWetKg), {
    measure: "order_remaining_wet", availableWetKg, requestedWetKg, unit: "kg",
  });
}
