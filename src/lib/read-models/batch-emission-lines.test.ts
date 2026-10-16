vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntries: vi.fn() }));
vi.mock("@/data-access/emission-automatic-masses", () => ({ getEmissionAutomaticMasses: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsForEntities: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservation: vi.fn(), getTemplateObservationById: vi.fn() }));

import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { listEmissionEntries } from "@/data-access/emission-entries";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { getTemplateObservationById } from "@/data-access/removal-template-observations";
import { getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { loadBatchEmissionLines } from "./batch-emission-lines";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCreditBatchById).mockResolvedValue({ removalTemplateId: "template", facilityId: "facility" } as never);
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
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).rejects.toThrowError(
    new SafeError("Delivery DL-2 has no load mass. Add it before submitting."),
  );
  expect(getTransportLegsForEntities).not.toHaveBeenCalled();
  expect(loadBiocharDeliveryTransportLegs).not.toHaveBeenCalled();
});

it("refuses a batch from another facility before loading accounting", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue({ facilityId: "other", removalTemplateId: "template" } as never);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).rejects.toThrow("Credit batch was not found.");
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
});

it("returns typed entry details and retains removed lines for re-entry", async () => {
  const current = { externalTemplateId: "template", definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "G", description: "", components: [{ id: "line", displayName: "Lab electricity", description: "Lab use", blueprintKey: "grid_electricity_use", inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } }, lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } };
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(current as never);
  vi.mocked(getTemplateObservationById).mockResolvedValue(current as never);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ batch: { lineageFacts: { runs: [], runForwards: {} } } } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  vi.mocked(listEmissionEntries).mockResolvedValue([{ id: "entry", componentId: "line", kind: "value", observationId: "previous", version: 2, occurredOn: "2026-10-15", note: null, documentCount: 0, values: [{ inputKey: "electricity_use", magnitude: "0.1", unit: "kWh", massDistanceDetail: null }] }] as never);
  const [line] = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(line).toMatchObject({ label: "Lab electricity", description: "Lab use", unit: "kWh", entryPolicy: "additive", state: "missingEvidence", blocker: { code: "entryMissingEvidence" }, total: { magnitude: "0.1", unit: "kWh" }, entries: [{ id: "entry", version: 2, counts: true, documentCount: 0 }] });
  vi.mocked(getLatestTemplateObservation).mockResolvedValue({ ...current, definition: { groups: [] }, lineSources: {}, enrichment: {} } as never);
  const [removed] = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(removed).toMatchObject({ label: "Lab electricity", entries: [{ id: "entry", counts: false, canConfirm: false }] });
});
