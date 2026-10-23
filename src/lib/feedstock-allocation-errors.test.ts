import { describe, expect, it } from "vitest";
import { DomainError } from "./domain-errors";
import { withIntakeAllocationIssues } from "./feedstock-allocation-errors";

describe("intake allocation refusal fields", () => {
  it.each([
    ["deliveryDate", new Date("2026-03-01"), new Date("2026-04-01")],
    ["storageLocationId", "old-bin", "new-bin"],
    ["massWetKg", 100, 0],
    ["moistureContentPercent", 20, null],
  ])("maps insufficient stock to changed %s", async (field, previous, next) => {
    const meta = { storageLocationId: "bin", availableWetKg: 0, requestedWetKg: 100, unit: "kg" };
    const error = new DomainError("insufficient_stock", "No qualifying intake", {
      issues: [{ path: ["feedstockDraws", 0, "storageLocationId"], code: "insufficient_stock", message: "No qualifying intake", meta }],
    });
    await expect(withIntakeAllocationIssues(() => Promise.reject(error), { [field]: previous }, { [field]: next }))
      .rejects.toMatchObject({ code: error.code, message: error.message,
        issues: [{ path: [field], code: error.code, message: error.message, meta }] });
  });
  it("includes only changed intake fields in a lineage refusal", async () => {
    await expect(withIntakeAllocationIssues(() => Promise.reject(new DomainError("certification_locked", "Sent lineage")),
      { massWetKg: 100, deliveryDate: "2026-03-01" }, { massWetKg: 100, deliveryDate: "2026-04-01", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["deliveryDate"], code: "certification_locked", message: "Sent lineage" }] });
  });
  it.each(["certification_locked", "insufficient_stock"] as const)("maps create %s to deliveryDate", async code => {
    await expect(withIntakeAllocationIssues(() => Promise.reject(new DomainError(code, "Refused")), {}, { deliveryDate: "2026-03-01" }))
      .rejects.toMatchObject({ code, message: "Refused", issues: [{ path: ["deliveryDate"], code, message: "Refused" }] });
  });
  it("preserves unrelated errors", async () => {
    const error = new DomainError("concurrent_write_retry", "Retry", { retryable: true });
    await expect(withIntakeAllocationIssues(() => Promise.reject(error), {}, {})).rejects.toBe(error);
  });
});
