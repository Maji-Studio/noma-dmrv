import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
vi.mock("@/data-access/utils", () => ({ requireOrgScope: vi.fn(), requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsForEntities: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/emission-automatic-masses", () => ({ getEmissionAutomaticMasses: vi.fn() }));
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { loadBatchesEmissionAutomaticFacts } from "./batch-emission-automatic-figures";

const ctx = makeTestOrgContext();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadCreditBatchRollups).mockResolvedValue(Object.fromEntries(["a", "b"].map((id) => [id, {
    lineageFacts: {
      runs: [{ id, feedstocks: [{ id: "feedstock" }, { id: "feedstock" }] }],
      applications: [{ id: "application" }, { id: "application" }, { id: "second-application" }],
      runForwards: { [id]: [{ id: "product", deliveries: [{ id: "delivery", code: "DL-1", wetMassKg: id === "a" ? "100.1" : "200.2" }] }] },
    },
  }])) as never);
  vi.mocked(getProductionRunsForCertification).mockResolvedValue([
    { id: "a", electricityKwh: 12 }, { id: "b", electricityKwh: null },
  ] as never);
  vi.mocked(getSamplesByCreditBatchIds).mockResolvedValue([]);
  vi.mocked(getTransportLegsForEntities).mockImplementation(async (_ctx, kind) => kind === "feedstock"
    ? [{ id: "leg", entityId: "feedstock", loadMassKg: 100, distanceKm: 2 }] as never : []);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([
    { id: "delivery", entityId: "delivery", loadMassKg: 999, distanceKm: 10 },
  ] as never);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: { leg: "100" } });
});

it("counts unique records and retains batch delivery shares with a constant number of reads", async () => {
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["a", "b"]);
  expect(facts.a.automaticRecordCounts).toMatchObject({ "run-electricity": 1, "feedstock-transport": 1, "delivery-transport": 1, sequestration: 2, "safety-margin": 2, "biochar-dry-mass": 1 });
  expect(facts.a.automaticFigures["run-electricity"]).toEqual({ magnitude: "12", unit: "kWh" });
  expect(facts.b.automaticFigures["run-electricity"]).toBeNull();
  expect(facts.a.automaticFigures["delivery-transport"]).toEqual({ magnitude: "2.002", unit: "km * tonne" });
  expect(facts.b.automaticFigures["delivery-transport"]).toEqual({ magnitude: "4.004", unit: "km * tonne" });
  expect(loadCreditBatchRollups).toHaveBeenCalledExactlyOnceWith(ctx, ["a", "b"], { includeRunForwards: true });
  expect(getProductionRunsForCertification).toHaveBeenCalledExactlyOnceWith(ctx, ["a", "b"]);
  expect(getTransportLegsForEntities).toHaveBeenCalledTimes(2);
  expect(loadBiocharDeliveryTransportLegs).toHaveBeenCalledTimes(1);
  expect(getEmissionAutomaticMasses).toHaveBeenCalledTimes(1);
});

it("keeps delivery counts when their figure is unknown and leaves other figures readable", async () => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ a: { lineageFacts: {
    runs: [{ id: "a", feedstocks: [] }], applications: [],
    runForwards: { a: [{ id: "product", deliveries: [{ id: "delivery", code: "DL-1", wetMassKg: null }] }] },
  } } } as never);
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["a"]);
  expect(facts.a.automaticRecordCounts?.["delivery-transport"]).toBe(1);
  expect(facts.a.automaticFigures["delivery-transport"]).toBeNull();
  expect(facts.a.automaticFigures["run-electricity"]?.magnitude).toBe("12");
});
