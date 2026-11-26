import { getTransportFeedstockIdsCountedElsewhere } from "./certification-lineage-guards";
vi.mock("./certification-lineage-guards", () => ({ getTransportFeedstockIdsCountedElsewhere: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
vi.mock("@/data-access/utils", () => ({ requireOrgScope: vi.fn(), requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsForEntities: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/feedstock-transport-ownership", () => ({ getFeedstockTransportOwnerBatches: vi.fn(), getFeedstockTransportOwners: vi.fn() }));
vi.mock("@/data-access/emission-automatic-masses", () => ({ getEmissionAutomaticMasses: vi.fn() }));
vi.mock("./credit-batch-emission-contributors", () => ({ loadBatchEmissionContributors: vi.fn() }));
import { loadBatchEmissionContributors } from "./credit-batch-emission-contributors";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { getFeedstockTransportOwnerBatches, getFeedstockTransportOwners } from "@/data-access/feedstock-transport-ownership";
import { loadBatchesEmissionAutomaticFacts } from "./batch-emission-automatic-figures";

const ctx = makeTestOrgContext();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTransportFeedstockIdsCountedElsewhere).mockResolvedValue(new Set());
  vi.mocked(loadBatchEmissionContributors).mockResolvedValue({});
  vi.mocked(loadCreditBatchRollups).mockResolvedValue(Object.fromEntries(["a", "b"].map((id) => [id, {
    batch: { id, productionEmissionsClaimedByRemovalId: null },
    lineageFacts: {
      runs: [{ id, feedstocks: [{ id: "feedstock", ownsTransport: true }, { id: "feedstock", ownsTransport: true }] }],
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
  vi.mocked(getFeedstockTransportOwnerBatches).mockResolvedValue(new Map());
});

it("counts unique records and retains batch delivery shares with a constant number of reads", async () => {
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["a", "b"]);
  expect(facts.a.automaticRecordCounts).toMatchObject({ "run-electricity": 1, "feedstock-transport": 1, "delivery-transport": 1, sequestration: 2, "safety-margin": 2, "biochar-dry-mass": 1 });
  expect(facts.a.automaticFigures["run-electricity"]).toEqual({ magnitude: "12", unit: "kWh" });
  expect(facts.b.automaticFigures["run-electricity"]).toBeNull();
  expect(facts.a.automaticFigures["delivery-transport"]).toEqual({ magnitude: "2.002", unit: "km * tonne" });
  expect(facts.b.automaticFigures["delivery-transport"]).toEqual({ magnitude: "4.004", unit: "km * tonne" });
  expect(loadCreditBatchRollups).toHaveBeenCalledExactlyOnceWith(ctx, ["a", "b"], { includeRunForwards: true }, expect.anything());
  expect(getProductionRunsForCertification).toHaveBeenCalledExactlyOnceWith(ctx, ["a", "b"], expect.anything());
  expect(getTransportLegsForEntities).toHaveBeenCalledExactlyOnceWith(ctx, "feedstock", ["feedstock"], expect.anything());
  expect(getSamplesByCreditBatchIds).not.toHaveBeenCalled();
  expect(facts.a.automaticRecordCounts?.["sample-transport"]).toBe(0);
  expect(facts.a.automaticFigures["sample-transport"]).toBeNull();
  expect(getFeedstockTransportOwners).not.toHaveBeenCalled();
  expect(loadBiocharDeliveryTransportLegs).toHaveBeenCalledTimes(1);
  expect(getEmissionAutomaticMasses).toHaveBeenCalledTimes(1);
});

it("keeps delivery counts when their figure is unknown and leaves other figures readable", async () => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ a: { batch: { id: "a", productionEmissionsClaimedByRemovalId: null }, lineageFacts: {
    runs: [{ id: "a", feedstocks: [] }], applications: [],
    runForwards: { a: [{ id: "product", deliveries: [{ id: "delivery", code: "DL-1", wetMassKg: null }] }] },
  } } } as never);
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["a"]);
  expect(facts.a.automaticRecordCounts?.["delivery-transport"]).toBe(1);
  expect(facts.a.automaticFigures["delivery-transport"]).toBeNull();
  expect(facts.a.automaticFigures["run-electricity"]?.magnitude).toBe("12");
});

it("threads the supplied transaction to every automatic-facts reader", async () => {
  const tx = {} as Parameters<typeof loadBatchesEmissionAutomaticFacts>[3];
  await loadBatchesEmissionAutomaticFacts(ctx, ["a", "b"], {}, tx);
  expect(loadBatchEmissionContributors).toHaveBeenCalledExactlyOnceWith(ctx, ["a", "b"], tx, { failedOnly: true });
  for (const reader of [loadCreditBatchRollups, getProductionRunsForCertification, getSamplesByCreditBatchIds,
    getTransportLegsForEntities, loadBiocharDeliveryTransportLegs, getEmissionAutomaticMasses]) {
    for (const call of vi.mocked(reader).mock.calls) expect(call.at(-1)).toBe(tx);
  }
});

it("does not count or request earlier-run transport in a later batch", async () => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ b: { batch: { id: "b", productionEmissionsClaimedByRemovalId: null }, lineageFacts: {
    runs: [{ id: "b", feedstocks: [{ id: "earlier", ownsTransport: false }] }],
    applications: [], runForwards: {},
  } } } as never);
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["b"]);
  expect(getTransportLegsForEntities).toHaveBeenCalledExactlyOnceWith(ctx, "feedstock", [], expect.anything());
  expect(facts.b.automaticRecordCounts?.["feedstock-transport"]).toBe(0);
});

it("names the other batches that count an owned-elsewhere batch's transport", async () => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ b: { batch: { id: "b", productionEmissionsClaimedByRemovalId: null }, lineageFacts: {
    runs: [{ id: "b", feedstocks: [{ id: "f1", ownsTransport: false }, { id: "f2", ownsTransport: false }] }],
    applications: [], runForwards: {},
  } } } as never);
  vi.mocked(getFeedstockTransportOwnerBatches).mockResolvedValue(new Map([
    ["f1", [{ creditBatchId: "x", code: "CB-26-002" }]],
    ["f2", [{ creditBatchId: "y", code: "CB-26-001" }]],
  ]));
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["b"]);
  expect(getFeedstockTransportOwnerBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["f1", "f2"], expect.anything());
  expect(facts.b.feedstockTransportCountedOn).toEqual([
    { creditBatchId: "y", code: "CB-26-001" }, { creditBatchId: "x", code: "CB-26-002" },
  ]);
  expect(facts.b.automaticFigures["feedstock-transport"]).toEqual({ magnitude: "0", unit: "km * tonne" });
});


it("adds failed production inputs without adding failed output to material figures", async () => {
  vi.mocked(loadBatchEmissionContributors).mockResolvedValue({ a: {
    materialMembers: [], failedContributors: [{ runId: "failed", creditBatchId: "a", feedstockIds: ["failed-feedstock"] }],
  } } as never);
  vi.mocked(getFeedstockTransportOwners).mockResolvedValue(new Map([["failed-feedstock", "failed"]]));
  vi.mocked(getProductionRunsForCertification).mockResolvedValue([
    { id: "a", electricityKwh: 12 }, { id: "failed", electricityKwh: 5 },
  ] as never);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {
    a: { id: "a", feedstockMassDryKg: "10", biocharDryMassKg: "3" },
    failed: { id: "failed", feedstockMassDryKg: "20", biocharDryMassKg: "99" },
  }, legs: {} });
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["a"]);
  expect(facts.a.automaticFigures["run-electricity"]?.magnitude).toBe("17");
  expect(facts.a.automaticFigures["feedstock-dry-mass"]?.magnitude).toBe("30");
  expect(facts.a.automaticFigures["biochar-dry-mass"]?.magnitude).toBe("3");
  expect(facts.a.automaticRecordCounts?.["run-electricity"]).toBe(2);
  expect(getTransportLegsForEntities).toHaveBeenCalledExactlyOnceWith(ctx, "feedstock", ["feedstock", "failed-feedstock"], expect.anything());
});


it("excludes failed-owned transport already counted by another Removal", async () => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ a: { batch: { id: "a", productionEmissionsClaimedByRemovalId: null }, lineageFacts: {
    runs: [], applications: [], runForwards: {},
  } } } as never);
  vi.mocked(loadBatchEmissionContributors).mockResolvedValue({ a: {
    materialMembers: [], failedContributors: [{ runId: "failed", creditBatchId: "a", feedstockIds: ["failed-feedstock"] }],
  } } as never);
  vi.mocked(getFeedstockTransportOwners).mockResolvedValue(new Map([["failed-feedstock", "failed"]]));
  vi.mocked(getTransportFeedstockIdsCountedElsewhere).mockResolvedValue(new Set(["failed-feedstock"]));
  const facts = await loadBatchesEmissionAutomaticFacts(ctx, ["a"]);
  expect(getTransportLegsForEntities).toHaveBeenCalledExactlyOnceWith(ctx, "feedstock", [], expect.anything());
  expect(facts.a.automaticFigures["feedstock-transport"]).toEqual({ magnitude: "0", unit: "km * tonne" });
  expect(facts.a.automaticRecordCounts?.["feedstock-transport"]).toBe(0);
});


it.each([undefined, "reviewing-removal", null])("resolves failed transport relative to the batch claim or explicit review %s", async removalId => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ a: {
    batch: { id: "a", productionEmissionsClaimedByRemovalId: "claiming-removal" },
    lineageFacts: { runs: [], applications: [], runForwards: {} },
  } } as never);
  vi.mocked(loadBatchEmissionContributors).mockResolvedValue({ a: {
    materialMembers: [], failedContributors: [{ runId: "failed", creditBatchId: "a", feedstockIds: ["failed-feedstock"] }],
  } } as never);
  vi.mocked(getFeedstockTransportOwners).mockResolvedValue(new Map([["failed-feedstock", "failed"]]));
  await loadBatchesEmissionAutomaticFacts(ctx, ["a"], { removalId });
  expect(getTransportFeedstockIdsCountedElsewhere).toHaveBeenCalledExactlyOnceWith(ctx, ["failed-feedstock"],
    removalId === undefined ? "claiming-removal" : removalId, expect.anything());
});
