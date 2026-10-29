import { DomainError, type DomainErrorCode, type DomainIssue } from "@/lib/domain-errors";
import { IN_USE_DELETE_MARKER, inUseDeleteRefusal } from "@/lib/delete-refusal";
import { SafeError } from "@/lib/errors";
import { RATIO_SUM_EXCEEDED_MESSAGE } from "./formulation-ratios";

export const FORMULATION_IN_USE_PREFIX = `Formulation ${IN_USE_DELETE_MARKER}`;

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
/** What uses a formulation, and the refusal meta key that names the codes. */
export const FORMULATION_IN_USE_KINDS = {
  "biochar products": "productCodes",
  "product bins": "binCodes",
  orders: "orderCodes",
} as const;
export type FormulationInUseKind = keyof typeof FORMULATION_IN_USE_KINDS;

export function formulationInUse(kind: FormulationInUseKind, codes: string[]): DomainError {
  return inUseDeleteRefusal(`${FORMULATION_IN_USE_PREFIX} ${kind} use it. Keep this formulation.`, ["formulationId"], { meta: { [FORMULATION_IN_USE_KINDS[kind]]: codes } });
}

export function formulationFreezesTypeUsage(name: string): DomainError {
  return refusal("conflict", `This feedstock type is used by formulation ${name}, so its usage cannot change.`, ["usage"]);
}
