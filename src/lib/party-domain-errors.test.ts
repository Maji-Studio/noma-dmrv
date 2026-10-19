import { describe, expect, it } from "vitest";
import { IN_USE_DELETE_MARKER } from "./delete-refusal";
import { customerLocationHasOrders, customerLocationHasStorageSite } from "./party-domain-errors";

describe("customer location delete refusals", () => {
  it.each([
    { archived: false, message: "Customer location was not deleted because orders use it. Archive it instead." },
    { archived: true, message: "Customer location was not deleted because orders use it." },
  ])("keeps order metadata and uses archive-appropriate wording (archived=$archived)", ({ archived, message }) => {
    const error = customerLocationHasOrders(["ORD-001"], archived);
    expect(error).toMatchObject({ code: "conflict", message });
    expect(error.message).toContain(IN_USE_DELETE_MARKER);
    expect(error.issues).toEqual([{ code: "conflict", path: ["locationId"], message, meta: { orderCodes: ["ORD-001"] } }]);
  });

  it.each([
    { archived: false, message: "Customer location was not deleted because it is registered with Isometric as a storage site. Archive it instead." },
    { archived: true, message: "Customer location was not deleted because it is registered with Isometric as a storage site." },
  ])("keeps storage-site refusal details and uses archive-appropriate wording (archived=$archived)", ({ archived, message }) => {
    const error = customerLocationHasStorageSite(archived);
    expect(error).toMatchObject({ code: "conflict", message });
    expect(error.message).toContain(IN_USE_DELETE_MARKER);
    expect(error.issues).toEqual([{ code: "conflict", path: ["locationId"], message }]);
  });

  it("preserves active-location wording and empty order metadata when state is omitted", () => {
    expect(customerLocationHasOrders()).toMatchObject({
      message: "Customer location was not deleted because orders use it. Archive it instead.",
      issues: [{ meta: { orderCodes: [] } }],
    });
    expect(customerLocationHasStorageSite().message).toBe("Customer location was not deleted because it is registered with Isometric as a storage site. Archive it instead.");
  });
});
