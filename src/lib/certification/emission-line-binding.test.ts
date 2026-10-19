import { expect, it } from "vitest";
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
