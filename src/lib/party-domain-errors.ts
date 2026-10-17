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

export function customerLocationHasOrders(orderCodes: string[] = []): DomainError {
  return partyRefusal("conflict", `Customer location ${IN_USE_DELETE_MARKER} orders use it. Archive it instead.`, ["locationId"], { orderCodes });
}
export function customerLocationHasStorageSite(): DomainError {
  return partyRefusal("conflict", `Customer location ${IN_USE_DELETE_MARKER} it is registered with Isometric as a storage site. Archive it instead.`, ["locationId"]);
}
export function customerLocationCertificationLocked(field: "name" | "gpsLatitude" | "gpsLongitude"): DomainError {
  return partyRefusal("certification_locked", "This location is registered with Isometric as a storage site, so its name and coordinates cannot change. Add a new location instead.", [field]);
}
export function storageSiteRegistrationBusy(): DomainError {
  const message = "This location is being registered with Isometric. Try again in a moment.";
  return new DomainError("conflict", message, { retryable: true, issues: [{ path: ["locationId"], code: "conflict", message }] });
}

export function customerLocationArchived(name: string, path: DomainIssue["path"] = ["customerLocationId"]): DomainError {
  return partyRefusal("not_found", `Customer location ${name} is archived. Restore it or choose another location.`, path);
}
export function customerLocationArchivedForEdit(name: string): DomainError {
  return partyRefusal("not_found", `Customer location ${name} is archived. Restore it before editing it.`, ["locationId"]);
}
export function customerLocationArchiveConflict(name: string, archived: boolean): DomainError {
  return partyRefusal("conflict", `Customer location ${name} is ${archived ? "already archived" : "not archived"}.`, ["locationId"]);
}
export function customerLocationLastActive(name: string): DomainError {
  return partyRefusal("conflict", `${name} is this customer's only active location, so it cannot be archived. Add or restore another location first.`, ["locationId"]);
}

export function customerHasDeliveries(deliveryCodes: string[] = []): DomainError {
  return partyRefusal("conflict", `Customer ${IN_USE_DELETE_MARKER} deliveries were recorded on its orders. Archive it instead.`, ["customerId"], { deliveryCodes });
}
export function cascadeChanged(): DomainError {
  return partyRefusal("cascade_changed", "The orders this delete would remove changed since the preview. Review them and confirm again.", ["cascadeFingerprint"]);
}
