import { DomainError, type DomainErrorCode, type DomainIssue } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { RATIO_SUM_EXCEEDED_MESSAGE } from "./formulation-ratios";

function refusal(code: DomainErrorCode, message: string, path: DomainIssue["path"], meta?: DomainIssue["meta"]): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError(code, detail, { issues: [{ path, code, message: detail, ...(meta ? { meta } : {}) }] });
}
export function formulationNotFound(path: DomainIssue["path"] = ["formulationId"]): DomainError {
  return refusal("not_found", "Formulation not found", path);
}
export function formulationArchived(code: string, path: DomainIssue["path"] = ["formulationId"]): DomainError {
  return refusal("not_found", `Formulation ${code} is archived. Restore it or choose another formulation.`, path);
}
export function formulationArchivedForEdit(code: string): DomainError {
  return refusal("not_found", `Formulation ${code} is archived. Restore it before editing it.`, ["formulationId"]);
}
export function formulationArchiveConflict(code: string, archived: boolean): DomainError {
  return refusal("conflict", `Formulation ${code} is ${archived ? "already archived" : "not archived"}.`, ["formulationId"]);
}
export function formulationTypeNotFound(index: number): DomainError {
  return refusal("not_found", "1 Feedstock type was not found. Refresh the formulation and choose the feedstock types again.", ["lines", index, "feedstockTypeId"]);
}
export function formulationTypeNotBlend(index: number): DomainError {
  return refusal("validation_failed", "Formulation lines must use blend-usage feedstock types", ["lines", index, "feedstockTypeId"]);
}
export function formulationRatioExceeded(): DomainError {
  return refusal("validation_failed", RATIO_SUM_EXCEEDED_MESSAGE, ["biocharRatio"]);
}
export function formulationLineInUse(formulationIngredientId: string, feedstockTypeId: string, productCodes: string[]): DomainError {
  return refusal("conflict", "This line is used by saved biochar products, so it cannot be removed. Keep the line or create a new formulation.", ["lines"], { formulationIngredientId, feedstockTypeId, productCodes });
}
export function formulationInUse(kind: "biochar products" | "product bins" | "orders", codes: string[]): DomainError {
  const key = kind === "biochar products" ? "productCodes" : kind === "product bins" ? "binCodes" : "orderCodes";
  return refusal("conflict", `Formulation was not deleted because ${kind} use it. Keep this formulation.`, ["formulationId"], { [key]: codes });
}
export function formulationFreezesTypeUsage(name: string): DomainError {
  return refusal("conflict", `This feedstock type is used by formulation ${name}, so its usage cannot change.`, ["usage"]);
}
