import { describe, expect, it } from "vitest";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { inUseDeleteRefusal } from "./delete-refusal";
import { customerHasDeliveries, customerHasStorageSites, customerLocationHasOrders, customerLocationHasStorageSite, supplierHasIntakes } from "./party-domain-errors";
import { formulationInUse } from "./formulation-domain-errors";

describe("inUseDeleteRefusal", () => {
  it("keeps the conflict contract and merges metadata without mutating it", () => {
    const meta = { orderCodes: ["ORD-001"], reason: "old" };
    const conflict = { entity: "order", id: "order-id", code: conflictCode("ORD-001") };
    const error = inUseDeleteRefusal("Keep this record.", ["customerId"], meta, conflict);
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
