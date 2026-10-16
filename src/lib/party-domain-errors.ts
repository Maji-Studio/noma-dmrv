import { DomainError, type DomainErrorCode, type DomainIssue } from "@/lib/domain-errors";
import { IN_USE_DELETE_MARKER } from "@/lib/delete-refusal";
import { SafeError } from "@/lib/errors";

type Party = "supplier" | "customer";
export function partyRefusal(code: DomainErrorCode, message: string, path: DomainIssue["path"], meta?: DomainIssue["meta"]): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError(code, detail, { issues: [{ path, code, message: detail, ...(meta ? { meta } : {}) }] });
}
export function partyNotFound(kind: Party, path: DomainIssue["path"] = [`${kind}Id`]): DomainError {
  return partyRefusal("not_found", kind === "supplier" ? "Supplier not found" : "Customer not found", path);
}
export function partyArchived(kind: Party, code: string, path: DomainIssue["path"] = [`${kind}Id`]): DomainError {
  const noun = kind === "supplier" ? "Supplier" : "Customer";
  return partyRefusal("not_found", `${noun} ${code} is archived. Restore it or choose another ${kind}.`, path);
}
export function partyArchivedForEdit(kind: Party, code: string): DomainError {
  const noun = kind === "supplier" ? "Supplier" : "Customer";
  return partyRefusal("not_found", `${noun} ${code} is archived. Restore it before editing it.`, [`${kind}Id`]);
}
export function partyArchiveConflict(kind: Party, code: string, archived: boolean): DomainError {
  const noun = kind === "supplier" ? "Supplier" : "Customer";
  return partyRefusal("conflict", `${noun} ${code} is ${archived ? "already archived" : "not archived"}.`, [`${kind}Id`]);
}
export function partyNameConflict(message: string, meta?: DomainIssue["meta"]): DomainError {
  return partyRefusal("conflict", message, ["name"], meta);
}
export function supplierHasIntakes(feedstockCodes: string[] = []): DomainError {
  return partyRefusal("conflict", `Supplier ${IN_USE_DELETE_MARKER} feedstock intakes still use it. Review the linked intakes or keep this supplier.`, ["supplierId"], { feedstockCodes });
}
export function customerHasOrders(orderCodes: string[] = []): DomainError {
  return partyRefusal("conflict", `Customer ${IN_USE_DELETE_MARKER} orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer.`, ["customerId"], { orderCodes });
}
export function customerHasStorageSites(locationIds: string[] = []): DomainError {
  return partyRefusal("conflict", `Customer ${IN_USE_DELETE_MARKER} its locations are registered storage sites. Keep this customer.`, ["customerId"], { locationIds });
}

export function partyLocationNotFound(kind: Party): DomainError {
  return partyRefusal("not_found", kind === "supplier" ? "Supplier location not found" : "Customer location not found", ["locationId"]);
}
