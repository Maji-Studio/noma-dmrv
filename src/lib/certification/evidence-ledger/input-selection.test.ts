import { expect, it } from "vitest";
import type { Sample, TransportLeg } from "@/db/schema";
import { selectThousandYearLedgerSamples, selectTwoHundredYearLedgerSamples, transportLedgerInput } from "./input-selection";

const sample = (overrides: Partial<Sample>) => ({ id: "sample", samplingTime: new Date("2026-01-01T23:30:00Z"),
  hToCOrgRatio: null, oToCOrgRatio: null, totalCarbonPercent: null, inorganicCarbonPercent: null,
  organicCarbonPercent: null, ...overrides } as Sample);
it("keeps non-rendered chemistry operands but omits their display-only sampling days", () => {
  const rows = selectTwoHundredYearLedgerSamples([
    sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, inorganicCarbonPercent: 1, organicCarbonPercent: 79 }),
    sample({ id: "fallback", totalCarbonPercent: 82, organicCarbonPercent: 80 }),
    sample({ id: "measured", totalCarbonPercent: 83, inorganicCarbonPercent: 2, organicCarbonPercent: 81 }),
  ], "Africa/Dar_es_Salaam").samples;
  expect(rows[0].input.samplingDay).toBe("2026-01-02");
  expect(rows[1].input).toMatchObject({ totalCarbonPercent: 82, organicCarbonPercent: 80, inorganicCarbonPercent: null });
  expect(rows[1].input).not.toHaveProperty("samplingDay");
  expect(rows[2].input.organicCarbonPercent).toBeNull();
});
it("omits the whole unsampled 200-year batch", () => {
  expect(selectTwoHundredYearLedgerSamples([sample({ hToCOrgRatio: -1 }), sample({ hToCOrgRatio: Number.NaN })])).toEqual({ samples: [], replicates: [] });
});
it("keeps complete 1000-year measured replicates in identity order, with original row references", () => {
  const complete = sample({ id: "b", totalCarbonPercent: 80, inorganicCarbonPercent: 1, sReflectanceFraction: 0.9 });
  const rows = selectThousandYearLedgerSamples([complete,
    sample({ id: "a", totalCarbonPercent: 80, sReflectanceFraction: 0.9 }),
    sample({ id: "c", totalCarbonPercent: Number.POSITIVE_INFINITY, inorganicCarbonPercent: 1, sReflectanceFraction: 0.9 }),
  ], "Africa/Dar_es_Salaam");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sample: complete, index: 1, input: { samplingDay: "2026-01-02", totalCarbonPercent: 80, inorganicCarbonPercent: 1, sReflectanceFraction: 0.9 } });
});
it("normalizes only the transport operands read by the evidence row", () => {
  expect(transportLedgerInput({ distanceKm: 12, loadMassKg: -1, transportMethodType: "road" } as TransportLeg))
    .toEqual({ distanceKm: 12, loadMassKg: 0, transportMethodType: "Road" });
});
