import { describe, expect, it } from "vitest";
import type { CreditBatchChainData } from "@/data-access/chain-of-custody-batch";
import { projectBatchRecords } from "./removal-records";

const run = (id: string, date: string, dry: number | null, shared = false) => ({
  source: {
    productionRun: { id, code: `PR-${id}`, date: new Date(`${date}T08:00:00Z`), biocharDryMassKg: dry, biocharStorageName: "Bin 2" },
    reactor: shared ? null : { identifier: "Reactor 1" },
    feedstocks: [{ id: `fs-${id}`, code: `FS-${id}`, deliveryDate: `${date}`, supplierName: "Sao Hill sawmill", wetMassUsedKg: 500, massDryKg: 200 }],
  },
});

const lineage = (n: string, date: string, tons: number | null) => ({
  chain: {
    application: { id: `ap-${n}`, code: `AP-${n}`, applicationDate: date, fieldIdentifier: "Field 3", biocharAppliedDryTons: tons },
    delivery: { id: `dl-${n}`, code: `DL-${n}`, deliveryDate: date, massDryKg: null, deliveredWetMassKg: 900 },
  },
});

const CHAIN = {
  batch: { id: "cb-1", code: "CB-26-001", startDate: "2026-02-01", endDate: "2026-03-01" },
  rollForwards: [run("b", "2026-02-20", 3200), run("a", "2026-02-10", 2800, true), run("a", "2026-02-10", 2800, true)],
  lineages: [lineage("2", "2026-03-02", 1.5), lineage("1", "2026-03-01", null)],
} as unknown as CreditBatchChainData;

describe("projectBatchRecords", () => {
  const records = projectBatchRecords(CHAIN);

  it("sorts each group by date and drops repeats of one record", () => {
    expect(records.productionRuns.map((r) => r.id)).toEqual(["a", "b"]);
    expect(records.applications.map((r) => r.id)).toEqual(["ap-1", "ap-2"]);
  });

  it("names place and mass, falling back to the storage name when there is no reactor", () => {
    expect(records.productionRuns[0]).toMatchObject({ place: "Bin 2", massKg: 2800, basis: "dry" });
    expect(records.productionRuns[1]).toMatchObject({ place: "Reactor 1", massKg: 3200 });
  });

  it("converts an application's dry tons to kg and leaves a missing mass null", () => {
    expect(records.applications[1].massKg).toBe(1500);
    expect(records.applications[0].massKg).toBeNull();
  });

  it("uses the application's field as the delivery place and wet mass when no dry mass is recorded", () => {
    expect(records.deliveries[0]).toMatchObject({ place: "Field 3", massKg: 900, basis: "wet" });
  });

  it("reads feedstock mass as wet when the wet mass used is recorded", () => {
    expect(records.feedstock[0]).toMatchObject({ massKg: 500, basis: "wet", place: "Sao Hill sawmill" });
  });
});

describe("projectBatchRecords with split shares", () => {
  it("sums one application's allocations across runs (600 + 400 kg)", () => {
    const chain = { ...CHAIN, rollForwards: [], lineages: [lineage("1", "2026-03-01", 0.6), lineage("1", "2026-03-01", 0.4)] } as unknown as CreditBatchChainData;
    const { applications, deliveries } = projectBatchRecords(chain);
    expect(applications).toHaveLength(1);
    expect(applications[0].massKg).toBeCloseTo(1000);
    expect(deliveries).toHaveLength(1);
  });

  it("leaves the application mass unknown when one slice has none", () => {
    const chain = { ...CHAIN, rollForwards: [], lineages: [lineage("1", "2026-03-01", 0.6), lineage("1", "2026-03-01", null)] } as unknown as CreditBatchChainData;
    expect(projectBatchRecords(chain).applications[0].massKg).toBeNull();
  });

  it("sums the draws of two runs on one feedstock intake (600 + 400 kg), counting a repeated run once", () => {
    const draw = (runId: string, wet: number) => ({
      source: {
        productionRun: { id: runId, code: `PR-${runId}`, date: new Date("2026-02-10T08:00:00Z"), biocharDryMassKg: 100, biocharStorageName: null },
        reactor: null,
        feedstocks: [{ id: "fs-1", code: "FS-1", deliveryDate: "2026-02-01", supplierName: "Mill", wetMassUsedKg: wet, massDryKg: 2000 }],
      },
    });
    const chain = { ...CHAIN, lineages: [], rollForwards: [draw("a", 600), draw("b", 400), draw("b", 400)] } as unknown as CreditBatchChainData;
    const { feedstock } = projectBatchRecords(chain);
    expect(feedstock).toHaveLength(1);
    expect(feedstock[0]).toMatchObject({ massKg: 1000, basis: "wet" });
  });
});

describe("projectBatchRecords delivery day", () => {
  it("uses the facility's calendar day for a delivery instant", () => {
    const chain = { ...CHAIN, rollForwards: [], lineages: [{ chain: { application: { id: "ap", code: "AP", applicationDate: "2026-03-01", fieldIdentifier: null, biocharAppliedDryTons: 1 }, delivery: { id: "dl", code: "DL", deliveryDate: new Date("2026-02-19T21:30:00Z"), massDryKg: 1, deliveredWetMassKg: null } } }] } as unknown as CreditBatchChainData;
    expect(projectBatchRecords(chain, "Africa/Dar_es_Salaam").deliveries[0].date).toBe("2026-02-20");
    expect(projectBatchRecords(chain, "UTC").deliveries[0].date).toBe("2026-02-19");
  });
});
