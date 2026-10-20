import { expect, it } from "vitest";
import { validateLineSources } from "@/lib/isometric/template-observations/line-sources";
import type { TemplateComponent } from "@/lib/isometric/template-observations/types";
import { emissionLineBindingDecision, lineCompilesWithoutEmissionSource } from "./emission-line-binding";

const safetyMargin: TemplateComponent = {
  id: "component-safety-margin", displayName: "Safety margin", description: null, blueprintKey: "mass_based_ci_emissions",
  inputs: [{ key: "mass", type: "monitored", quantityKind: "mass" }],
};

it("blocks a Safety margin line whose reviewed contract has no automatic source", () => {
  expect(lineCompilesWithoutEmissionSource(safetyMargin)).toBe(false);
  const decision = emissionLineBindingDecision({
    component: safetyMargin, groupKey: "miscellaneous", problems: [], enrichmentComplete: true,
    contract: { scope: "operating", entryPolicy: "none", origin: "reviewed" },
  });
  expect(decision).toMatchObject({ state: "needsSetup", reason: "unmapped", blocker: { code: "lineNeedsSetup" } });
});

it("binds the Safety margin line through its reviewed automatic source", () => {
  expect(emissionLineBindingDecision({
    component: safetyMargin, groupKey: "miscellaneous", problems: [], enrichmentComplete: true,
    contract: { scope: "operating", automaticSource: "safety-margin", entryPolicy: "none", origin: "reviewed" },
  })).toBeUndefined();
});

// Reviewed operating contracts may combine an additive entry policy with an automatic source.
it.each([false, true])("checks unmapped inputs when an automatic source is present (%s)", (automatic) => {
  const decision = emissionLineBindingDecision({
    component: { ...safetyMargin, blueprintKey: "transport", inputs: [
      { key: "mass", type: "monitored", quantityKind: "mass" },
      { key: "distance", type: "monitored", quantityKind: "distance" },
    ] },
    groupKey: "biomass-feedstock-transport", problems: [], enrichmentComplete: true, entriesCanSubmit: true,
    contract: { scope: "operating", entryPolicy: "additive", origin: "reviewed",
      ...(automatic ? { automaticSource: "feedstock-transport" as const } : {}) },
  });
  if (automatic) expect(decision).toMatchObject({ state: "needsSetup", inputKeys: ["mass"], blocker: { code: "lineNeedsSetup" } });
  else expect(decision).toBeUndefined();
});

it("allows the paired transport automatic contract through source validation", () => {
  const component: TemplateComponent = { ...safetyMargin, blueprintKey: "transport", inputs: [
    { key: "mass", type: "monitored", quantityKind: "mass" },
    { key: "distance", type: "monitored", quantityKind: "distance" },
  ] };
  expect(validateLineSources({ groups: [{ id: "transport", key: "biomass-feedstock-transport", displayName: "Transport", description: "", components: [component] }] }, {
    [component.id]: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: "feedstock-transport" },
  })).toEqual([]);
});
