import { describe, expect, it } from "vitest";
import { createFormulationInput, updateFormulationInput, deleteFormulationInput } from "./formulation-input";
import { createFormulationSchema, updateFormulationSchema, formulationPercentFormSchema, percentFormToRatioPayload } from "./formulations";

const TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FORMULATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("formulation operation inputs", () => {
  it("trims names, canonicalizes UUIDs, and keeps null distinct from omission", () => {
    expect(createFormulationInput.parse({ name: " Blend ", lines: [{ feedstockTypeId: TYPE_ID.toUpperCase(), ratio: null }] })).toEqual({ name: "Blend", lines: [{ feedstockTypeId: TYPE_ID, ratio: null }] });
    expect(updateFormulationInput.parse({ formulationId: FORMULATION_ID, expectedVersion: 1 })).toEqual({ formulationId: FORMULATION_ID, expectedVersion: 1 });
    expect(updateFormulationInput.parse({ formulationId: FORMULATION_ID, expectedVersion: 1, biocharRatio: null, description: null })).toMatchObject({ biocharRatio: null, description: null });
  });
  it("refuses unknown keys and caller-supplied create codes", () => {
    for (const extra of [{ code: "BCF-MANUAL" }, { userId: "user" }, { extra: true }]) expect(createFormulationInput.safeParse({ name: "Blend", ...extra }).success).toBe(false);
    expect(createFormulationInput.safeParse({ name: "Blend", lines: [{ feedstockTypeId: TYPE_ID, description: "extra" }] }).success).toBe(false);
    expect(updateFormulationInput.safeParse({ formulationId: FORMULATION_ID, expectedVersion: 1, extra: true }).success).toBe(false);
    expect(deleteFormulationInput.safeParse({ formulationId: FORMULATION_ID, expectedVersion: 1, extra: true }).success).toBe(false);
  });
  it("limits lines and text and enforces the existing code format", () => {
    const lines = Array.from({ length: 51 }, () => ({ feedstockTypeId: crypto.randomUUID() }));
    expect(createFormulationInput.safeParse({ name: "Blend", lines: lines.slice(0, 50) }).success).toBe(true);
    expect(createFormulationInput.safeParse({ name: "Blend", lines }).success).toBe(false);
    expect(createFormulationInput.safeParse({ name: " ", description: "x".repeat(1001) }).success).toBe(false);
    expect(createFormulationInput.safeParse({ name: "x".repeat(256) }).success).toBe(false);
    expect(updateFormulationInput.safeParse({ formulationId: FORMULATION_ID, expectedVersion: 1, code: "lower case" }).success).toBe(false);
  });
  it("publishes six-decimal precision and points duplicates at their material", () => {
    expect(createFormulationInput.safeParse({ name: "Blend", biocharRatio: 0.333333 }).success).toBe(true);
    const fine = createFormulationInput.safeParse({ name: "Blend", biocharRatio: 0.3333333 });
    expect(fine.error?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_multiple_of", path: ["biocharRatio"] })]));
    const duplicate = createFormulationInput.safeParse({ name: "Blend", lines: [{ feedstockTypeId: TYPE_ID }, { feedstockTypeId: TYPE_ID.toUpperCase() }] });
    expect(duplicate.error?.issues).toMatchObject([{ path: ["lines", 1, "feedstockTypeId"] }]);
  });
  it.each([[1e-7, false], [4e-7, false], [5e-7, false], [0.0000015, false], [0.000001, true], [0.333333, true]])(
    "requires exact millionths for %s (accepted: %s)", (ratio, accepted) => {
      for (const schema of [createFormulationInput, updateFormulationInput]) {
        const base = schema === createFormulationInput ? { name: "Blend" } : { formulationId: FORMULATION_ID, expectedVersion: 1 };
        expect(schema.safeParse({ ...base, biocharRatio: ratio }).success).toBe(accepted);
        expect(schema.safeParse({ ...base, lines: [{ feedstockTypeId: TYPE_ID, ratio }] }).success).toBe(accepted);
      }
      for (const schema of [createFormulationSchema, updateFormulationSchema]) {
        const base = schema === createFormulationSchema ? { name: "Blend" } : { formulationId: FORMULATION_ID, expectedVersion: 1 };
        expect(schema.safeParse({ ...base, biocharRatio: ratio }).success).toBe(accepted);
        expect(schema.safeParse({ ...base, ingredients: [{ feedstockTypeId: TYPE_ID, ratio }] }).success).toBe(accepted);
      }
    },
  );
  it("accepts 100% and refuses 100.0001% at the percent form boundary", () => {
    const base = { name: "Blend", biocharPercent: 70, ingredients: [{ feedstockTypeId: TYPE_ID, sharePercent: 30 }] };
    const form = formulationPercentFormSchema.parse(base);
    expect(percentFormToRatioPayload(form)).toMatchObject({ biocharRatio: 0.7, ingredients: [{ ratio: 0.3 }] });
    const over = formulationPercentFormSchema.safeParse({ ...base, biocharPercent: 70.0001 });
    expect(over.error?.issues).toMatchObject([{ path: ["biocharPercent"] }]);
  });
});
