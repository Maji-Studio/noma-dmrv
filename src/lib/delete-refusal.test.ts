import { describe, expect, it } from "vitest";
import { ActionError } from "@/lib/action-error";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { IN_USE_REASON, inUseDeleteRefusal, isInUseDeleteRefusal } from "./delete-refusal";
import { customerHasDeliveries, customerHasStorageSites, customerLocationHasOrders, customerLocationHasStorageSite, supplierHasIntakes } from "./party-domain-errors";
import { formulationInUse } from "./formulation-domain-errors";

describe("inUseDeleteRefusal", () => {
  it("keeps the conflict contract and merges metadata without mutating it", () => {
    const meta = { orderCodes: ["ORD-001"], reason: "old" };
    const conflict = { entity: "order", id: "order-id", code: conflictCode("ORD-001") };
    const error = inUseDeleteRefusal("Keep this record.", ["customerId"], { meta, conflict });
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "conflict", message: "Keep this record.", conflict });
    expect(error.issues).toEqual([{
      path: ["customerId"], code: "conflict", message: error.message,
      meta: { orderCodes: ["ORD-001"], reason: "in_use" },
    }]);
    expect(meta).toEqual({ orderCodes: ["ORD-001"], reason: "old" });
  });

  it("adds the reason when no metadata or conflict is provided", () => {
    const error = inUseDeleteRefusal("Keep this record.", ["locationId"]);
    expect(error.conflict).toBeUndefined();
    expect(error.issues).toEqual([{
      path: ["locationId"], code: "conflict", message: error.message, meta: { reason: "in_use" },
    }]);
  });

  it.each([
    supplierHasIntakes(), customerHasStorageSites(), customerHasDeliveries(),
    customerLocationHasOrders(), customerLocationHasStorageSite(),
    formulationInUse("biochar products", ["BC-001"]),
    formulationInUse("product bins", ["BIN-001"]), formulationInUse("orders", ["ORD-001"]),
  ])("marks the in-use producer: $message", (error) => {
    expect(error.code).toBe("conflict");
    expect(error.issues).toEqual([expect.objectContaining({ code: "conflict", meta: expect.objectContaining({ reason: "in_use" }) })]);
  });
});

describe("isInUseDeleteRefusal", () => {
  it("recognizes the structured reason regardless of the message", () => {
    const message = "This record is still used.";
    const error = new ActionError({ error: message, code: "conflict", issues: [
      { path: ["name"], code: "conflict", message: "Name is taken." },
      { path: ["supplierId"], code: "conflict", message, meta: { reason: IN_USE_REASON } },
    ] });
    expect(isInUseDeleteRefusal(error)).toBe(true);
  });

  it("rejects ordinary conflicts and wording without the structured reason", () => {
    const message = "Customer was not deleted because orders still use it.";
    expect(isInUseDeleteRefusal(new ActionError({ error: "Name is taken.", code: "conflict", issues: [
      { path: ["name"], code: "conflict", message: "Name is taken." },
    ] }))).toBe(false);
    expect(isInUseDeleteRefusal(new ActionError({ error: message, code: "conflict" }))).toBe(false);
    expect(isInUseDeleteRefusal(new ActionError({ error: message, issues: [
      { path: [], code: "conflict", message, meta: { reason: "other" } },
    ] }))).toBe(false);
    expect(isInUseDeleteRefusal(new Error(message))).toBe(false);
    expect(isInUseDeleteRefusal(message)).toBe(false);
    expect(isInUseDeleteRefusal(null)).toBe(false);
  });

  it.each([undefined, "validation_failed", "not_found", "stale_version"] as const)("rejects a marked action with top-level code %s", (code) => {
    const message = "This record is still used.";
    const error = new ActionError({ error: message, code, issues: [
      { path: ["driverId"], code: "conflict", message, meta: { reason: IN_USE_REASON } },
    ] });
    expect(isInUseDeleteRefusal(error)).toBe(false);
  });
});
