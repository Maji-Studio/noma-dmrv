import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  latitudeSchema,
  MASS_INPUT_MAX_KG,
  MASS_KG_INPUT_STEP,
  optionalPercent,
  optionalStoredMoisture,
  positiveMassKgSchema,
  requiredMassKgSchema,
  RATIO_INPUT_MAX,
  STORED_PERCENT_INPUT_STEP,
  toIntOrNull,
  toNumberOrNull,
} from "@/schemas/helpers";
import { sampleFormSchema } from "@/schemas/samples";
import { formulationPercentFormSchema } from "@/schemas/formulations";
import { numberInputConstraints, numberInputConstraintsFor } from "./number-input-constraints";

describe("numberInputConstraints", () => {
  it("reads canonical percent and moisture constraints", () => {
    expect(numberInputConstraints(optionalPercent)).toEqual({ min: 0, max: 100, step: "any" });
    expect(numberInputConstraints(optionalStoredMoisture))
      .toEqual({ min: 0, max: 99.999999, step: STORED_PERCENT_INPUT_STEP });
  });

  it("reads piped and preprocessed mass and coordinate constraints", () => {
    expect(numberInputConstraints(requiredMassKgSchema()))
      .toEqual({ min: 0, max: MASS_INPUT_MAX_KG, step: MASS_KG_INPUT_STEP });
    expect(numberInputConstraints(z.preprocess(toNumberOrNull, positiveMassKgSchema())))
      .toEqual({ min: MASS_KG_INPUT_STEP, max: MASS_INPUT_MAX_KG, step: MASS_KG_INPUT_STEP });
    expect(numberInputConstraints(z.preprocess(toNumberOrNull, latitudeSchema)))
      .toEqual({ min: -90, max: 90, step: "any" });
    expect(numberInputConstraints(z.preprocess(toIntOrNull, z.number().int().min(0).max(100))))
      .toEqual({ min: 0, max: 100, step: 1 });
  });

  it("unwraps every supported wrapper and ignores refinements", () => {
    const base = z.number().min(0).max(100);
    const wrapped = [base.optional(), base.nullable(), base.default(0), base.prefault(0),
      base.catch(0), base.readonly(), base.optional().nonoptional(), z.lazy(() => base),
      base.refine(value => value > 20), base.superRefine(() => {}),
      base.transform(String)];
    for (const schema of wrapped) {
      expect(numberInputConstraints(schema)).toEqual({ min: 0, max: 100, step: "any" });
    }
  });

  it("uses the output number of a pipe before its input", () => {
    expect(numberInputConstraints(z.number().min(0).pipe(z.number().min(1))))
      .toEqual({ min: 1, step: "any" });
  });

  it("uses a union's single number branch and leaves ambiguous or nonnumeric schemas unconstrained", () => {
    expect(numberInputConstraints(z.union([z.literal(""), optionalPercent, z.null()])))
      .toEqual({ min: 0, max: 100, step: "any" });
    for (const schema of [z.string(), z.union([z.number().min(0), z.number().max(100)]),
      z.union([z.literal(""), z.null()])]) {
      expect(numberInputConstraints(schema)).toEqual({ step: "any" });
    }
  });

  it("omits implicit safe bounds on all integer variants", () => {
    for (const schema of [z.int(), z.number().int(), z.number().safe()]) {
      expect(numberInputConstraints(schema)).toEqual({ step: 1 });
    }
  });

  it("adjusts exclusive bounds with a numeric step and preserves tighter inclusive bounds", () => {
    expect(numberInputConstraints(z.number().int().gt(0).lt(100)))
      .toEqual({ min: 1, max: 99, step: 1 });
    expect(numberInputConstraints(z.number().gt(0).lt(100)))
      .toEqual({ min: 0, max: 100, step: "any" });
    expect(numberInputConstraints(z.number().multipleOf(0.000001).gt(0.1).lt(100)))
      .toEqual({ min: 0.100001, max: 99.999999, step: 0.000001 });
    expect(numberInputConstraints(z.number().int().min(5).gt(2).max(90).lt(100)))
      .toEqual({ min: 5, max: 90, step: 1 });
  });

  it("does not loop on recursive lazy schemas", () => {
    const recursive: z.ZodType = z.lazy(() => recursive);
    expect(numberInputConstraints(recursive)).toEqual({ step: "any" });
  });
});

describe("numberInputConstraintsFor", () => {
  it("reads the real sample form and caches results per path", () => {
    const constraints = numberInputConstraintsFor(sampleFormSchema);
    for (const path of ["totalCarbonPercent", "organicCarbonPercent"]) {
      expect(constraints(path)).toEqual({ min: 0, max: 100, step: "any" });
    }
    expect(constraints("hToCOrgRatio")).toEqual({ min: 0, max: RATIO_INPUT_MAX, step: "any" });
    expect(constraints("ph")).toEqual({ min: 0, max: 14, step: "any" });
    expect(constraints("ph")).toBe(constraints("ph"));
    expect(() => constraints("organicCarbonPercnet")).toThrow("organicCarbonPercnet");
  });

  it("walks array elements with and without indexes", () => {
    const constraints = numberInputConstraintsFor(formulationPercentFormSchema);
    for (const path of ["ingredients.0.sharePercent", "ingredients.sharePercent"]) {
      expect(constraints(path)).toEqual({ min: 0, max: 100, step: "any" });
    }
    expect(() => constraints("ingredients.0.missing")).toThrow("ingredients.0.missing");
  });

  it("walks nested, extended and wrapped objects and numeric array elements", () => {
    const nested = z.object({ field: optionalPercent }).extend({ count: z.int() }).refine(() => true);
    const constraints = numberInputConstraintsFor(z.preprocess(value => value,
      z.object({ nested: z.lazy(() => nested).optional(), values: z.array(z.int()) }).readonly()));
    expect(constraints("nested.field")).toEqual({ min: 0, max: 100, step: "any" });
    expect(constraints("nested.count")).toEqual({ step: 1 });
    expect(constraints("values.0")).toEqual({ step: 1 });
    expect(() => constraints("nested.field.bad")).toThrow("nested.field.bad");
    expect(() => constraints("")).toThrow('""');
  });
});
