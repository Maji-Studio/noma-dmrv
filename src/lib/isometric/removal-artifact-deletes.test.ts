import { describe, expect, it, vi } from "vitest";
import { IsometricApiError, type IsometricClient } from "./client";
import { deleteMeasurementSample, findMeasurementSampleBySupplierRef, getMeasurementSample } from "./measurement-samples";
import { deleteProductionBatch } from "./production-batches";

describe("Removal artifact HTTP wrappers", () => {
  it("encodes exact DELETE targets", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const client = { delete: remove } as unknown as IsometricClient;
    await deleteMeasurementSample(client, "mts/a");
    await deleteProductionBatch(client, "ptb/a");
    expect(remove.mock.calls).toEqual([["/measurement_samples/mts%2Fa"], ["/production_batches/ptb%2Fa"]]);
  });
  it("rejects duplicate measurement references across pages", async () => {
    const client = { paginate: async function* () {
      yield { id: "mts_1", supplier_reference_id: "ref" };
      yield { id: "mts_2", supplier_reference_id: "ref" };
    } } as unknown as IsometricClient;
    await expect(findMeasurementSampleBySupplierRef(client, "ref", { requireUnique: true })).rejects.toThrow("Multiple registry measurements");
  });
  it("finds exact measurement IDs through the documented collection endpoint", async () => {
    const client = { paginate: async function* () {
      yield { id: "mts_other", supplier_reference_id: "other" };
      yield { id: "mts_1", supplier_reference_id: "ref" };
    } } as unknown as IsometricClient;
    expect(await getMeasurementSample(client, "mts_1")).toMatchObject({ id: "mts_1" });
    expect(await getMeasurementSample(client, "missing")).toBeNull();
  });
  it.each([400, 401, 500])("does not treat a failed collection read as absence (%s)", async (status) => {
    const error = new IsometricApiError("failed", status, null, "http");
    const client = { paginate: async function* () { throw error; } } as unknown as IsometricClient;
    await expect(getMeasurementSample(client, "mts_1")).rejects.toBe(error);
  });
});
