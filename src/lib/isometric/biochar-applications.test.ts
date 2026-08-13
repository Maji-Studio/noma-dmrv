import { describe, expect, it } from "vitest";
import { buildBiocharApplicationRequestIfReady } from "./biochar-applications";

describe("Biochar Application contract gate", () => {
  it("returns no request for a net-mass-only application", () => {
    expect(
      buildBiocharApplicationRequestIfReady({
        applicationId: "app-1",
        creditBatchIds: ["batch-1"],
        netMassKg: 1_000,
      }),
    ).toEqual({
      status: "unsupported",
      ready: false,
      reason: "arrival_departure_mass_contract_missing",
      message: expect.stringContaining("separate observed truck masses"),
      request: null,
    });
  });

  it("fails closed before building an allocation for multiple batches", () => {
    expect(
      buildBiocharApplicationRequestIfReady({
        applicationId: "app-1",
        creditBatchIds: ["batch-1", "batch-2"],
        netMassKg: 1_000,
      }),
    ).toMatchObject({
      status: "unsupported",
      ready: false,
      reason: "multi_batch_allocation_contract_missing",
      request: null,
    });
  });
});
