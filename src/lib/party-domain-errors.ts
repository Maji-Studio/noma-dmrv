import { DomainError, type DomainErrorCode, type DomainIssue } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

type Party = "supplier" | "customer";
export function partyRefusal(code: DomainErrorCode, message: string, path: DomainIssue["path"], meta?: DomainIssue["meta"]): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError(code, detail, { issues: [{ path, code, message: detail, ...(meta ? { meta } : {}) }] });
}
export function partyNotFound(kind: Party): DomainError {
  return partyRefusal("not_found", kind === "supplier" ? "Supplier not found" : "Customer not found", [`${kind}Id`]);
}
export function partyNameConflict(message: string): DomainError {
  return partyRefusal("conflict", message, ["name"]);
}
export function supplierHasIntakes(feedstockCodes: string[] = []): DomainError {
  return partyRefusal("conflict", "Supplier was not deleted because feedstock intakes still use it. Review the linked intakes or keep this supplier.", ["supplierId"], { feedstockCodes });
}
export function customerHasOrders(orderCodes: string[] = []): DomainError {
  return partyRefusal("conflict", "Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer.", ["customerId"], { orderCodes });
}
export function customerHasStorageSites(locationIds: string[] = []): DomainError {
  return partyRefusal("conflict", "Customer was not deleted because its locations are registered storage sites. Keep this customer.", ["customerId"], { locationIds });
}
