import { describe, expect, it } from "vitest";
import {
  COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE,
  getSampleCarbonReconciliationErrors,
  ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE,
  sampleFormSchema,
  updateSampleSchema,
} from "./samples";
import { recordLabSampleInput, updateLabSampleApiInput } from "./lab-sample-input";
import { assertCarbonReconciliation } from "@/data-access/samples/carbon-reconciliation";
import { SampleFieldError } from "@/lib/sample-domain-errors";

describe("getSampleCarbonReconciliationErrors", () => {
  it("reports organic carbon above total carbon as soon as both values are complete", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 76,
      }),
    ).toEqual({
      organicCarbonPercent: ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE,
    });
  });

  it("stays silent until the relevant values are complete and outside tolerance", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
      }),
    ).toEqual({});
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 75.5,
      }),
    ).toEqual({});
  });

  it("reports the combined carbon overage once inorganic carbon is complete", () => {
    expect(
      getSampleCarbonReconciliationErrors({
        totalCarbonPercent: 75,
        organicCarbonPercent: 74,
        inorganicCarbonPercent: 2,
      }),
    ).toEqual({
      inorganicCarbonPercent: COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE,
    });
  });
});

// Soil Environments v1.3 Eq. 6 reads only the residual value; the sum check is
// noma's own (Kenji, 20 Oct): refuse only above 100% by more than the tolerance.
describe("reactive plus residual organic carbon", () => {
  const OVER_100 = "Reactive and residual carbon add up to 110%. Correct them to 100% or less.";
  const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const baseForm = { creditBatchId: ID, samplingTime: "2026-10-12T09:30:00Z", totalCarbonPercent: 80, organicCarbonPercent: 75, durabilityOption: "1000_year" };

  it("refuses on Residual carbon when the two add up to more than 100% beyond the tolerance", () => {
    expect(getSampleCarbonReconciliationErrors({ reactiveCarbonPercent: 40, residualCarbonPercent: 70 })).toEqual({ residualCarbonPercent: OVER_100 });
    expect(getSampleCarbonReconciliationErrors({ reactiveCarbonPercent: 40.1, residualCarbonPercent: 70.2 }).residualCarbonPercent)
      .toBe("Reactive and residual carbon add up to 110.3%. Correct them to 100% or less.");
    expect(getSampleCarbonReconciliationErrors({ reactiveCarbonPercent: 30, residualCarbonPercent: 70.6 }).residualCarbonPercent).toBeDefined();
  });

  it("stays silent within the tolerance, below 100% and until both values are entered", () => {
    expect(getSampleCarbonReconciliationErrors({ reactiveCarbonPercent: 30, residualCarbonPercent: 70.5 })).toEqual({});
    expect(getSampleCarbonReconciliationErrors({ reactiveCarbonPercent: 20, residualCarbonPercent: 60 })).toEqual({});
    expect(getSampleCarbonReconciliationErrors({ reactiveCarbonPercent: 40, residualCarbonPercent: null })).toEqual({});
    expect(getSampleCarbonReconciliationErrors({ residualCarbonPercent: 100 })).toEqual({});
  });

  it("refuses the form, the server update and the API bodies from otherwise valid input", () => {
    const over = { reactiveCarbonPercent: 40, residualCarbonPercent: 70 };
    const residualIssue = [expect.objectContaining({ path: ["residualCarbonPercent"], message: OVER_100 })];
    expect(sampleFormSchema.safeParse(baseForm).success).toBe(true);
    expect(sampleFormSchema.safeParse({ ...baseForm, ...over }).error?.issues).toEqual(residualIssue);
    expect(updateSampleSchema.safeParse({ sampleId: ID, expectedVersion: 1, ...over }).error?.issues).toEqual(residualIssue);
    expect(recordLabSampleInput.safeParse({ creditBatchId: ID, samplingTime: "2026-10-12T09:30:00Z", totalCarbonPercent: 80, organicCarbonPercent: 75, ...over }).error?.issues).toEqual(residualIssue);
    expect(updateLabSampleApiInput.safeParse(over).error?.issues).toEqual(residualIssue);
  });

  it("still lists the carbon refusals on a Save that also misses the sampling time", () => {
    const issues = sampleFormSchema.safeParse({ ...baseForm, samplingTime: "", reactiveCarbonPercent: 40, residualCarbonPercent: 70, organicCarbonPercent: 81 }).error?.issues ?? [];
    expect(issues.map(issue => issue.path[0]).sort()).toEqual(["organicCarbonPercent", "residualCarbonPercent", "samplingTime"]);
    expect(issues).toContainEqual(expect.objectContaining({ path: ["residualCarbonPercent"], message: OVER_100 }));
    // A carbon input that failed itself is not reconciled on top.
    const bad = sampleFormSchema.safeParse({ ...baseForm, reactiveCarbonPercent: 140, residualCarbonPercent: 70 }).error?.issues ?? [];
    expect(bad.map(issue => issue.path[0])).toEqual(["reactiveCarbonPercent"]);
    // An empty total carbon does not hold back the reactive plus residual check.
    const noTotal = sampleFormSchema.safeParse({ ...baseForm, totalCarbonPercent: undefined, reactiveCarbonPercent: 40, residualCarbonPercent: 70 }).error?.issues ?? [];
    expect(noTotal.map(issue => issue.path[0]).sort()).toEqual(["residualCarbonPercent", "totalCarbonPercent"]);
  });

  it("refuses a body that is not an object without reading carbon from it", () => {
    for (const body of [null, undefined]) {
      for (const schema of [sampleFormSchema, updateSampleSchema, recordLabSampleInput, updateLabSampleApiInput]) {
        const issues = schema.safeParse(body).error?.issues ?? [];
        expect(issues.map(issue => issue.path), String(body)).toEqual([[]]);
      }
    }
  });

  it("lists the carbon refusal beside an unrelated field error in the API bodies", () => {
    const over = { reactiveCarbonPercent: 40, residualCarbonPercent: 70 };
    const create = recordLabSampleInput.safeParse({ creditBatchId: ID, samplingTime: "2026-10-12T09:30:00Z", totalCarbonPercent: 80, organicCarbonPercent: 75, ph: 20, ...over }).error?.issues ?? [];
    expect(create.map(issue => issue.path[0]).sort()).toEqual(["ph", "residualCarbonPercent"]);
    const update = updateLabSampleApiInput.safeParse({ labName: 7, ...over }).error?.issues ?? [];
    expect(update.map(issue => issue.path[0]).sort()).toEqual(["labName", "residualCarbonPercent"]);
    expect(update).toContainEqual(expect.objectContaining({ path: ["residualCarbonPercent"], message: OVER_100 }));
  });

  it("refuses the saved Sample whose stored reactive plus a new residual goes over", () => {
    const stored = { totalCarbonPercent: 80, organicCarbonPercent: 75, inorganicCarbonPercent: null, reactiveCarbonPercent: 40, residualCarbonPercent: 50 };
    expect(() => assertCarbonReconciliation(stored, {})).not.toThrow();
    expect(() => assertCarbonReconciliation(stored, { residualCarbonPercent: 70 })).toThrow(OVER_100);
    try {
      assertCarbonReconciliation(stored, { residualCarbonPercent: 70 });
    } catch (error) {
      expect(error).toBeInstanceOf(SampleFieldError);
      expect((error as SampleFieldError).field).toBe("residualCarbonPercent");
    }
  });
});
