import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  buildPerBatchDurabilityData,
  type CreditBatchDurabilityInput,
  type FacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import { buildDurabilityLedgerModel } from "./durability-build-model";

type DurabilityBatchWithEndDate = CreditBatchDurabilityInput & {
  endDate?: string | null;
  facilityTimezone?: string | null;
};

function sample(overrides: Partial<Sample>): Sample {
  return {
    id: "s",
    sampleCode: "S-00",
    samplingTime: new Date("2026-01-12T00:00:00.000Z"),
    productionRunId: "run-a",
    labName: "Eurofins",
    hToCOrgRatio: null,
    oToCOrgRatio: null,
    totalCarbonPercent: null,
    organicCarbonPercent: null,
    inorganicCarbonPercent: null,
    ...overrides,
  } as unknown as Sample;
}

function batch(
  overrides: Partial<DurabilityBatchWithEndDate> &
    Pick<CreditBatchDurabilityInput, "creditBatchId" | "creditBatchCode">,
): DurabilityBatchWithEndDate {
  return {
    samples: [],
    runs: [{ id: "run-a", biocharDryMassKg: 1000 }],
    ...overrides,
  };
}

const SOIL: FacilityReferenceSoilTemperature = {
  declaredSoilTemperatureC: 12.5,
  effectiveSoilTemperatureC: 12.5,
  source: "Lembrechts 2022",
  temperatureFloored: false,
  method: "Facility reference soil temperature (annual average; 7 °C floor)",
  warnings: [],
};

const COMMON = {
  attributionByRunId: new Map<string, number>(),
  facilityReferenceSoilTemperature: SOIL,
  memberBatchCodes: "CB-A",
  facilityName: "DEC Pyrolysis",
  externalProjectId: "prj_X",
  generatedAtIso: "2026-01-31T00:00:00.000Z",
};

// Three eligible replicates across three distinct days.
const eligibleBatch = (id = "a", code = "CB-A"): CreditBatchDurabilityInput =>
  batch({
    creditBatchId: id,
    creditBatchCode: code,
    runs: [{ id: "run-a", biocharDryMassKg: 1000 }],
    samples: [
      sample({
        sampleCode: "S-A-01",
        samplingTime: new Date("2026-01-12T00:00:00.000Z"),
        hToCOrgRatio: 0.3,
        oToCOrgRatio: 0.04,
        totalCarbonPercent: 80,
        organicCarbonPercent: 79,
        inorganicCarbonPercent: 1,
      }),
      sample({
        sampleCode: "S-A-02",
        samplingTime: new Date("2026-01-13T00:00:00.000Z"),
        hToCOrgRatio: 0.31,
        oToCOrgRatio: 0.05,
        totalCarbonPercent: 82,
        organicCarbonPercent: 81,
        inorganicCarbonPercent: 1,
      }),
      sample({
        sampleCode: "S-A-03",
        samplingTime: new Date("2026-01-14T00:00:00.000Z"),
        hToCOrgRatio: 0.32,
        oToCOrgRatio: 0.06,
        totalCarbonPercent: 84,
        organicCarbonPercent: 83,
        inorganicCarbonPercent: 1,
      }),
    ],
  });

describe("buildDurabilityLedgerModel", () => {
  it("reconciles raw replicates to the SAME submitted figures the POST uses", () => {
    const batches = [eligibleBatch()];
    const model = buildDurabilityLedgerModel({ ...COMMON, batches });
    const [submitted] = buildPerBatchDurabilityData(batches, COMMON.attributionByRunId);

    expect(model.batches).toHaveLength(1);
    const b = model.batches[0];
    // The ledger's submitted figures equal the aggregation that feeds the POST.
    expect(b.hToCorg.mean).toBeCloseTo(submitted.hToCorgRatio!.mean, 10);
    expect(b.hToCorg.stdDev).toBeCloseTo(submitted.hToCorgRatio!.stdDev!, 10);
    expect(b.totalCarbonPercent?.mean).toBeCloseTo(
      submitted.totalCarbonPercent!.mean,
      10,
    );
    expect(b.inorganicCarbonPercent?.mean).toBeCloseTo(
      submitted.inorganicCarbonPercent!.mean,
      10,
    );
    expect(b.productMassKg).toBe(submitted.productMassKg);
    expect(b.replicateCount).toBe(3);
    expect(b.replicates).toHaveLength(3);
    expect(b.replicates.map((r) => r.ref)).toEqual(["R1", "R2", "R3"]);
    expect(b.replicates[0].sampleCode).toBe("S-A-01");
    expect(b.replicates[0].samplingDay).toBe("2026-01-12");
  });

  it("scales product mass by the per-run applied attribution", () => {
    const model = buildDurabilityLedgerModel({
      ...COMMON,
      batches: [eligibleBatch()],
      attributionByRunId: new Map([["run-a", 0.5]]),
    });
    expect(model.batches[0].productMassKg).toBe(500);
  });

  it("emits an eligible verdict when both means clear the §3 Table 2 ceilings", () => {
    const model = buildDurabilityLedgerModel({ ...COMMON, batches: [eligibleBatch()] });
    const e = model.batches[0].eligibility;
    expect(e.hToCWithinThreshold).toBe(true);
    expect(e.oToCWithinThreshold).toBe(true);
    expect(e.eligible).toBe(true);
    expect(model.eligibleBatchCount).toBe(1);
  });

  it("flags an ineligible verdict when the H/C_org mean breaches 0.5", () => {
    const ineligible = batch({
      creditBatchId: "x",
      creditBatchCode: "CB-X",
      samples: [
        sample({ sampleCode: "S-X-01", hToCOrgRatio: 0.6, oToCOrgRatio: 0.04, totalCarbonPercent: 80, organicCarbonPercent: 79 }),
        sample({ sampleCode: "S-X-02", hToCOrgRatio: 0.62, oToCOrgRatio: 0.05, totalCarbonPercent: 80, organicCarbonPercent: 79 }),
        sample({ sampleCode: "S-X-03", hToCOrgRatio: 0.64, oToCOrgRatio: 0.06, totalCarbonPercent: 80, organicCarbonPercent: 79 }),
      ],
    });
    const model = buildDurabilityLedgerModel({ ...COMMON, batches: [ineligible] });
    const e = model.batches[0].eligibility;
    expect(e.hToCWithinThreshold).toBe(false);
    expect(e.oToCWithinThreshold).toBe(true);
    expect(e.eligible).toBe(false);
    expect(model.eligibleBatchCount).toBe(0);
  });

  it("derives inorganic carbon (Total − Organic) and flags it when not measured", () => {
    const derived = batch({
      creditBatchId: "d",
      creditBatchCode: "CB-D",
      samples: [
        sample({
          sampleCode: "S-D-01",
          hToCOrgRatio: 0.3,
          oToCOrgRatio: 0.04,
          totalCarbonPercent: 85,
          organicCarbonPercent: 80,
          inorganicCarbonPercent: null,
        }),
      ],
    });
    const r = buildDurabilityLedgerModel({ ...COMMON, batches: [derived] })
      .batches[0].replicates[0];
    expect(r.inorganicCarbonPercent).toBe(5); // 85 − 80
    expect(r.inorganicDerived).toBe(true);
  });

  it("skips an unsampled batch (no H/C replicate) but keeps the soil block", () => {
    const unsampled = batch({ creditBatchId: "u", creditBatchCode: "CB-U" });
    const model = buildDurabilityLedgerModel({ ...COMMON, batches: [unsampled] });
    expect(model.batches).toHaveLength(0);
    expect(model.totalReplicates).toBe(0);
    expect(model.soil.effectiveSoilTemperatureC).toBe(12.5);
    expect(model.soil.source).toBe("Lembrechts 2022");
  });

  it("carries the floored soil reference through to the model", () => {
    const model = buildDurabilityLedgerModel({
      ...COMMON,
      batches: [eligibleBatch()],
      facilityReferenceSoilTemperature: {
        declaredSoilTemperatureC: 5,
        effectiveSoilTemperatureC: 7,
        source: null,
        temperatureFloored: true,
        method: "Facility reference soil temperature (annual average; 7 °C floor)",
        warnings: ["Soil temperature floored to 7 °C (§5.1.1.3.1)."],
      },
    });
    expect(model.soil.declaredSoilTemperatureC).toBe(5);
    expect(model.soil.effectiveSoilTemperatureC).toBe(7);
    expect(model.soil.temperatureFloored).toBe(true);
  });

  // The ledger's replicate days must be the facility-LOCAL calendar days, so the
  // evidence PDF agrees with the write guard and submission gate (issue #455).
  it("renders replicate sampling days in the facility timezone (UTC+3)", () => {
    // Africa/Nairobi (UTC+3): 21:30Z on the 14th is 00:30 local on the 15th.
    const model = buildDurabilityLedgerModel({
      ...COMMON,
      batches: [
        {
          ...eligibleBatch(),
          facilityTimezone: "Africa/Nairobi",
          samples: [
            sample({
              sampleCode: "S-A-01",
              samplingTime: new Date("2026-01-14T21:30:00.000Z"),
              hToCOrgRatio: 0.3,
              oToCOrgRatio: 0.04,
              totalCarbonPercent: 80,
              organicCarbonPercent: 79,
              inorganicCarbonPercent: 1,
            }),
          ],
        },
      ],
    });

    expect(model.batches[0].replicates[0].samplingDay).toBe("2026-01-15");
  });

  it("renders replicate sampling days in the facility timezone (UTC-8)", () => {
    // America/Los_Angeles (UTC-8): 03:30Z on the 15th is 19:30 local on the 14th.
    const model = buildDurabilityLedgerModel({
      ...COMMON,
      batches: [
        {
          ...eligibleBatch(),
          facilityTimezone: "America/Los_Angeles",
          samples: [
            sample({
              sampleCode: "S-A-01",
              samplingTime: new Date("2026-01-15T03:30:00.000Z"),
              hToCOrgRatio: 0.3,
              oToCOrgRatio: 0.04,
              totalCarbonPercent: 80,
              organicCarbonPercent: 79,
              inorganicCarbonPercent: 1,
            }),
          ],
        },
      ],
    });

    expect(model.batches[0].replicates[0].samplingDay).toBe("2026-01-14");
  });

  it("resolves offset-bearing string timestamps through the facility branch (UTC-8)", () => {
    // A raw/string-backed samplingTime must render on the same facility-local day
    // as a Date — it must not slice to the UTC day 2026-01-15.
    const model = buildDurabilityLedgerModel({
      ...COMMON,
      batches: [
        {
          ...eligibleBatch(),
          facilityTimezone: "America/Los_Angeles",
          samples: [
            sample({
              sampleCode: "S-A-01",
              samplingTime: "2026-01-15T03:30:00.000Z" as unknown as Date,
              hToCOrgRatio: 0.3,
              oToCOrgRatio: 0.04,
              totalCarbonPercent: 80,
              organicCarbonPercent: 79,
              inorganicCarbonPercent: 1,
            }),
          ],
        },
      ],
    });

    expect(model.batches[0].replicates[0].samplingDay).toBe("2026-01-14");
  });
});
