import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { PgReal } from "drizzle-orm/pg-core";
import { samples } from "@/db/schema";
import { deriveSampleRatios } from "@/lib/calculations/sample-ratios";
import { normalizeSampleRealValues, REAL_FIELDS } from "./normalize-values";

const UNDERFLOW_CARBON = 2.225073858507203e-309;
const UNDERFLOW_HYDROGEN = 1e-200;
const REPRESENTABLE_DENORMAL = 1e-40;
const EXPECTED_VERSION = 1;

describe("normalizeSampleRealValues", () => {
  it("covers exactly the sample table's real columns", () => {
    const realFields = Object.entries(getTableColumns(samples))
      .filter(([, column]) => column instanceof PgReal)
      .map(([key]) => key);
    expect(new Set(REAL_FIELDS)).toEqual(new Set(realFields));
  });

  it("makes ratio derivation see stored zeros without mutating the request", () => {
    const request = {
      expectedVersion: EXPECTED_VERSION,
      organicCarbonPercent: UNDERFLOW_CARBON,
      totalHydrogenPercent: UNDERFLOW_HYDROGEN,
      totalOxygenPercent: UNDERFLOW_HYDROGEN,
      oToCOrgRatio: null,
    };
    const normalized = normalizeSampleRealValues(request);
    expect(normalized).toEqual({ ...request, organicCarbonPercent: 0, totalHydrogenPercent: 0, totalOxygenPercent: 0 });
    expect(deriveSampleRatios(normalized)).toEqual({ hToCOrgRatio: null, oToCOrgRatio: null, notices: [] });
    expect(request.organicCarbonPercent).toBe(UNDERFLOW_CARBON);
    expect(request.totalHydrogenPercent).toBe(UNDERFLOW_HYDROGEN);
  });

  it("preserves omitted fields, explicit clears, exact numeric ratios and representable denormals", () => {
    const request = {
      expectedVersion: EXPECTED_VERSION,
      inorganicCarbonPercent: null,
      totalHydrogenPercent: undefined,
      moistureContentPercent: REPRESENTABLE_DENORMAL,
      oToCOrgRatio: UNDERFLOW_CARBON,
    };
    expect(normalizeSampleRealValues(request)).toEqual(request);
    expect(normalizeSampleRealValues(request)).not.toHaveProperty("organicCarbonPercent");
  });
});
