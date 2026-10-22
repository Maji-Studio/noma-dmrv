import { DomainError, type DomainErrorCode, type DomainIssue } from "@/lib/domain-errors";
import { IN_USE_DELETE_MARKER, inUseDeleteRefusal } from "@/lib/delete-refusal";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import { SafeError } from "@/lib/errors";
import { formatStockMinimumKg } from "@/lib/stock-overdraw";

export type OrderRelationshipField = "facilityId" | "customerId" | "customerLocationId" | "formulationId";
export type OrderReferenceField = OrderRelationshipField | "orderId";

const REFERENCE_LABELS: Record<OrderReferenceField, string> = {
  facilityId: "Facility", customerId: "Customer", customerLocationId: "Customer location",
  formulationId: "Formulation", orderId: "Order",
};

function refusal(code: DomainErrorCode, message: string, path: DomainIssue["path"], meta?: DomainIssue["meta"]): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError(code, detail, {
    issues: [{ path, code, message: detail, ...(meta ? { meta } : {}) }],
  });
}

/** Unknown and foreign references have the same outcome, without disclosing the other Organization. */
export function orderReferenceNotFound(field: OrderReferenceField): DomainError {
  return refusal("not_found", `${REFERENCE_LABELS[field]} not found`, [field]);
}

/** Every relationship is frozen once any delivery exists, including archived deliveries. */
export function orderRelationshipFrozen(field: OrderRelationshipField, deliveryCode: string): DomainError {
  const lock = recordLocks.order({ removals: [], dependents: [{ kind: "delivery", id: deliveryCode }] });
  return refusal("certification_locked", withRecordLockGuidance(`Order relationship is used by delivery ${deliveryCode}.`, lock), [field]);
}

export function orderQuantityBelowAllocated(allocatedWetKg: number): DomainError {
  return refusal("validation_failed", `Order quantity cannot be less than the ${formatStockMinimumKg(allocatedWetKg)} already allocated to deliveries.`,
    ["quantityKg"], { allocatedWetKg, unit: "kg" });
}

export function orderHasDeliveries(delivery: { id: string; code: string }, orderCode?: string): DomainError {
  return inUseDeleteRefusal(
    `Order${orderCode ? ` ${orderCode}` : ""} ${IN_USE_DELETE_MARKER} delivery ${delivery.code} still uses it. Delete that delivery first, or keep this order.`,
    ["orderId"], { code: "certification_locked", meta: { deliveryCode: delivery.code, deliveryId: delivery.id } },
  );
}

/** PATCH refuses archived orders; DELETE still works when the order has no deliveries. */
export function orderArchived(code: string): DomainError {
  return refusal("not_found", `Order ${code} is archived. Restore its facility before editing the order.`, ["orderId"]);
}

export function orderCustomerLocationMismatch(): DomainError {
  return refusal("validation_failed", "Delivery location belongs to a different customer", ["customerLocationId"]);
}

// Code collisions use withUniqueCodeGuard and CODE_CONFLICT_MESSAGES.order.
// Lineage guards use withFeedstockErrors(work, "certification_locked", ["orderId"]).
// Archived facilities use lockActiveFacilityReference wrapped in withFeedstockErrors(work, "not_found", ["facilityId"]).
