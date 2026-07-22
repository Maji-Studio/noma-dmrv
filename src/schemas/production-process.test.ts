import { describe, expect, it } from "vitest";
import { recordMethodBPrerequisitesSchema } from "./production-process";

describe("recordMethodBPrerequisitesSchema", () => {
  const valid = {
    processId: "de000000-0000-4000-a000-000000000101",
    agreedBaselineSize: 30,
    randomSamplingPlanRef: "PDD §8.3",
    moisturePathway: "measured_every_batch" as const,
  };

  it("accepts all three prerequisites at the baseline floor", () => {
    expect(recordMethodBPrerequisitesSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an agreed baseline below the named floor", () => {
    expect(
      recordMethodBPrerequisitesSchema.safeParse({
        ...valid,
        agreedBaselineSize: 29,
      }).success,
    ).toBe(false);
  });
});
