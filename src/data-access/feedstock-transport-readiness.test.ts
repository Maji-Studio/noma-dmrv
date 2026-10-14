import { describe, expect, it, vi } from "vitest";
import type { Executor } from "./utils";
import { withFeedstockTransportReadiness } from "./feedstock-transport-readiness";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const stock = { id: "fs-1", status: "complete", massWetKg: 100, transportDistanceKm: null, transportDistanceSource: null };
const manualLeg = { entityId: stock.id, distanceKm: 10, loadMassKg: 50, distanceSource: "manual", isDerived: false };

function executor(legs: object[]) {
  const where = vi.fn(async () => legs);
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  return { tx: { select } as unknown as Executor, select };
}

describe("feedstock transport readiness projection", () => {
  it("accepts manual-only coverage even when the feedstock wet mass is zero", async () => {
    const { tx, select } = executor([manualLeg]);
    const [row] = await withFeedstockTransportReadiness(makeTestOrgContext(), [{ ...stock, massWetKg: 0 }], tx);
    expect(row.hasUsableTransportLeg).toBe(true);
    expect(deriveEntityCertifyReadiness("feedstock", row).state).toBe("ready");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0, -1, NaN, Infinity])("rejects leg mass %s despite a positive feedstock mass", async (loadMassKg) => {
    const { tx } = executor([{ ...manualLeg, loadMassKg }]);
    const [row] = await withFeedstockTransportReadiness(makeTestOrgContext(), [stock], tx);
    expect(deriveEntityCertifyReadiness("feedstock", row).gaps).toContainEqual(expect.objectContaining({ key: "transportLeg" }));
  });

  it("requires a usable leg for each row in one page read", async () => {
    const { tx, select } = executor([manualLeg]);
    const rows = await withFeedstockTransportReadiness(makeTestOrgContext(), [stock, { ...stock, id: "fs-2" }], tx);
    expect(rows.map((row) => row.hasUsableTransportLeg)).toEqual([true, false]);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
