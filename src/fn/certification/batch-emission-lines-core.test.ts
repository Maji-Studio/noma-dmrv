import { beforeEach, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsForEntities: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn() }));

import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { loadBatchEmissionLines } from "./batch-emission-lines-core";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCreditBatchById).mockResolvedValue({ removalTemplateId: "template" } as never);
  vi.mocked(getLatestTemplateObservation).mockResolvedValue({} as never);
  vi.mocked(getProductionRunsForCertification).mockResolvedValue([]);
  vi.mocked(getSamplesByCreditBatchIds).mockResolvedValue([]);
});

it("names the first delivery without load mass before requesting any transport legs", async () => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ batch: { lineageFacts: {
    runs: [], runForwards: { run: [{ deliveries: [
      { id: "complete", code: "DL-1", wetMassKg: 10 },
      { id: "missing", code: "DL-2", wetMassKg: null },
      { id: "also-missing", code: "DL-3", wetMassKg: null },
    ] }] },
  } } } as never);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "batch")).rejects.toThrowError(
    new SafeError("Delivery DL-2 has no load mass. Add it before submitting."),
  );
  expect(getTransportLegsForEntities).not.toHaveBeenCalled();
  expect(loadBiocharDeliveryTransportLegs).not.toHaveBeenCalled();
});
