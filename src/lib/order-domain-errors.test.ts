import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));

import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "@/data-access/code-generator";
import { orders } from "@/db/schema";
import { toActionFailure } from "@/fn/action-errors";
import { actionFailureResponse, ACTION_STATUS, jsonPointer } from "@/lib/api/problem";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import {
  orderArchived, orderCustomerLocationMismatch, orderHasDeliveries,
  orderQuantityBelowAllocated, orderReferenceNotFound, orderRelationshipFrozen,
} from "./order-domain-errors";

const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const options = { fallbackMessage: "Failed to save order", log: { message: "test" } };

describe("order errors", () => {
  it.each(["formulationId", "facilityId", "customerId", "customerLocationId"] as const)("freezes %s with a 409 and its pointer", field => {
    const error = orderRelationshipFrozen(field, "DL-26-001");
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "conflict", issues: [{ path: [field], code: "conflict", message: error.message }], retryable: false });
    expect(ACTION_STATUS[error.code]).toBe(409);
    expect(jsonPointer(error.issues[0].path)).toBe(`/${field}`);
  });

  it("keeps the allocated wet kg metadata on the quantity issue across action and REST", async () => {
    const error = orderQuantityBelowAllocated(100.125);
    expect(error.message).toBe("Order quantity cannot be less than the 100.2 kg already allocated to deliveries.");
    expect(error).toMatchObject({ code: "validation_failed", issues: [{ path: ["quantityKg"], code: "validation_failed", meta: { allocatedWetKg: 100.125, unit: "kg" } }] });
    expect(error).not.toHaveProperty("meta");
    const failure = toActionFailure(error, options);
    expect(failure).toMatchObject({ success: false, error: error.message, code: "validation_failed", issues: error.issues });
    const response = actionFailureResponse(failure, "/api/v1/orders/order-id", "request-id");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: [{ pointer: "/quantityKg", code: "validation_failed", meta: { allocatedWetKg: 100.125, unit: "kg" } }] });
  });

  it.each(["orderId", "facilityId", "customerId", "customerLocationId", "formulationId"] as const)("uses not_found for foreign or unknown %s", field => {
    const error = orderReferenceNotFound(field);
    expect(error).toMatchObject({ code: "not_found", issues: [{ path: [field], code: "not_found", message: error.message }] });
    expect(ACTION_STATUS[error.code]).toBe(404);
    expect(jsonPointer(error.issues[0].path)).toBe(`/${field}`);
    expect(error.message).not.toContain(ctx.organizationId);
  });

  it("reuses the shared lineage wrapper with certification_locked and a pointer", async () => {
    const message = "Cannot update this order because it is locked by a certification submission.";
    const error = await withFeedstockErrors(async () => { throw new SafeError(message); }, "certification_locked", ["orderId"]).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "certification_locked", message, issues: [{ path: ["orderId"], code: "certification_locked", message }] });
    expect(ACTION_STATUS.certification_locked).toBe(409);
    const typed = orderHasDeliveries();
    await expect(withFeedstockErrors(async () => { throw typed; })).rejects.toBe(typed);
  });

  it("reuses the org-scoped duplicate-code guard with a 409 on /code", async () => {
    const collision = { code: "23505", constraint: "orders_organization_id_code_unique" };
    const error = await withUniqueCodeGuard(ctx, orders, orders.code, CODE_CONFLICT_MESSAGES.order, async () => { throw collision; }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "conflict", message: CODE_CONFLICT_MESSAGES.order, issues: [{ path: ["code"], code: "conflict", message: CODE_CONFLICT_MESSAGES.order }] });
    expect(ACTION_STATUS.conflict).toBe(409);
    const unrelated = { code: "23505", constraint: "other_unique" };
    await expect(withUniqueCodeGuard(ctx, orders, orders.code, CODE_CONFLICT_MESSAGES.order, async () => { throw unrelated; })).rejects.toBe(unrelated);
  });

  it("refuses archived order edits and archived facility writes with a 404 and pointer", async () => {
    const orderError = orderArchived("OR-26-001");
    expect(orderError.message).toBe("Order OR-26-001 is archived. Restore its facility before editing the order.");
    const facilityRefusal = new SafeError("Facility not found or archived");
    const facilityMessage = facilityRefusal.message;
    const facilityError = await withFeedstockErrors(async () => { throw facilityRefusal; }, "not_found", ["facilityId"]).catch((failure: unknown) => failure);
    for (const [error, field, message] of [[orderError, "orderId", orderError.message], [facilityError, "facilityId", facilityMessage]] as const) {
      expect(error).toMatchObject({ code: "not_found", message, issues: [{ path: [field], code: "not_found", message }] });
      const response = actionFailureResponse(toActionFailure(error, options), "/api/v1/orders/order-id", "request-id");
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ errors: [{ pointer: `/${field}`, code: "not_found" }] });
    }
  });

  it("refuses deletion with deliveries and mismatched customer locations", () => {
    expect(orderHasDeliveries()).toMatchObject({ code: "conflict", issues: [{ path: ["orderId"], code: "conflict" }] });
    expect(orderHasDeliveries().message).not.toContain("Remove deliveries first");
    expect(orderCustomerLocationMismatch()).toMatchObject({ code: "validation_failed", issues: [{ path: ["customerLocationId"], code: "validation_failed" }] });
    expect(ACTION_STATUS.validation_failed).toBe(422);
  });
});
