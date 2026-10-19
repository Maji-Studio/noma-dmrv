import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { getTransportLegsWithEvidenceForEntities } from "@/data-access/transport-legs";
import { buildLedgerModel } from "@/lib/certification/evidence-ledger/build-model";
import { aggregateProductionRuns, enrichWithTransportLegs, type ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { loadTransportLegsByCategory } from "./shared";

vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsWithEvidenceForEntities: vi.fn() }));

const lineages = [{ delivery: { id: "delivery-1" }, application: { biocharAppliedTons: 0.025 } }] as ChainOfCustodyData[];
const entityIds = { feedstockIds: [], biocharProductIds: ["product-1"], sampleIds: [] };
const runs = [{
  id: "run-1", code: "PR-1", biocharDryMassKg: 100, feedstockMassDryKg: 200,
  dieselOperationLiters: 0, dieselGensetLiters: 0, preprocessingFuelLiters: 0, electricityKwh: 0,
  startTime: new Date("2026-01-01"), endTime: new Date("2026-01-02"), samples: [],
}] as unknown as ProductionRunForCertification[];
const metadata = { memberBatchCodes: null, facilityName: null, externalProjectId: null, generatedAtIso: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTransportLegsWithEvidenceForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([{
    id: "delivery-1", entityId: "delivery-1", entityType: "biochar",
    distanceKm: 0, loadMassKg: 25, isDerived: true,
    transportMethodType: "road", calculationMethodType: "distance_based",
  } as never]);
});

describe("template-scoped biochar transport", () => {
  it("omits incomplete delivery routes from submission aggregation and ledger when not required", async () => {
    const legs = await loadTransportLegsByCategory(makeTestOrgContext(), entityIds, lineages, []);
    expect(loadBiocharDeliveryTransportLegs).not.toHaveBeenCalled();
    expect(legs.biochar).toEqual([]);
    const aggregate = enrichWithTransportLegs(aggregateProductionRuns(runs), legs);
    expect(aggregate.warnings).toEqual([]);
    expect(aggregate.biocharTransportMassDistanceTonneKm).toBeNull();
    expect(buildLedgerModel({ ...metadata, legsByCategory: legs }).categories[1].legs).toEqual([]);
  });

  it("retains missing-distance blockers for submission and ledger when required", async () => {
    const legs = await loadTransportLegsByCategory(makeTestOrgContext(), entityIds, lineages, ["biochar"]);
    expect(loadBiocharDeliveryTransportLegs).toHaveBeenCalledWith(makeTestOrgContext(), [{ deliveryId: "delivery-1", loadMassKg: 25 }]);
    expect(enrichWithTransportLegs(aggregateProductionRuns(runs), legs).warnings).not.toEqual([]);
    expect(() => buildLedgerModel({ ...metadata, legsByCategory: legs })).toThrow();
  });
});
