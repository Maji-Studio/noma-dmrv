import { unsupportedTemplate } from "../../../tests/fixtures/isometric/unsupported-template";
import { describe, expect, it } from "vitest";
import sandbox from "../../../tests/fixtures/isometric/sandbox-template.json";
import inventory from "../../../tests/fixtures/isometric-coverage.json";
import type { components } from "./generated/certify";
import { findUnbindableTemplateInputs, formatUnbindableTemplateInputs, type UnbindableTemplateInput } from "./template-binding-coverage";
import { lookupInputMapping, lookupPeriodInputTuple } from "./datapoint-mapping";
import { isSequestrationBlueprintFamily } from "./storage-blueprints";

type Template = components["schemas"]["GhgEntryTemplate"];
const template = sandbox as Template;


describe("template binding coverage", () => {
  it.each([true, false])("accepts the sandbox template (stubs: %s)", (allowPeriodInputStub) => {
    expect(template.id).toBe(inventory.facilities[0].defaultRemovalTemplateId);
    expect(findUnbindableTemplateInputs(template, { allowPeriodInputStub })).toEqual([]);
  });

  it("flags both unsupported truck components without flagging sample transport", () => {
    const changed = unsupportedTemplate();
    const findings = findUnbindableTemplateInputs(changed);
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((input) => input.componentId)).size).toBe(2);
    expect(findings.every((input) => input.blueprintKey === "transport" && input.reason === "unmapped")).toBe(true);
    expect(formatUnbindableTemplateInputs(findings)).toContain("Mass-distance-based CI emissions");
    expect(changed).toEqual(unsupportedTemplate());
  });

  it("rejects two sample components receiving the full aggregate", () => {
    const copy = unsupportedTemplate();
    const group = copy.groups.find((group) => group.key === "sampling-required-for-mrv")!;
    const sample = group.components.find((component) => component.blueprint_key === "mass_distance_based_ci_emissions")!;
    group.components.push({ ...structuredClone(sample), id: "sample-copy", display_name: "Second sample shipment" });
    const findings = findUnbindableTemplateInputs(copy).filter((input) => input.reason === "ambiguous");
    expect(findings.map((input) => input.reason)).toEqual(["ambiguous", "ambiguous"]);
    expect(formatUnbindableTemplateInputs(findings)).toContain(`${sample.display_name} and Second sample shipment would both receive the same sample transport mass-distance total`);
  });

  it("matches the builder lookup precedence for every sandbox input", () => {
    for (const group of template.groups) for (const component of group.components) {
      if (isSequestrationBlueprintFamily(component.blueprint_key)) continue;
      for (const input of component.inputs) {
        if (input.type === "fixed") continue;
        expect(lookupPeriodInputTuple(group.key, component.blueprint_key, input.input_key, component.display_name) ?? lookupInputMapping(group.key, component.blueprint_key, input.input_key)).toBeDefined();
      }
    }
  });

it("keeps project-scope stubs and storage inputs under their existing guards", () => {
  const copy = structuredClone(template);
  const direct = copy.groups.find((group) => group.key === "direct-emissions")!;
  direct.components.push({
    ...structuredClone(template.groups.find((group) => group.key === "pyrolysis")!.components[0]),
    id: "project-input", display_name: "Project emissions", blueprint_key: "ghg_direct_emissions",
    inputs: [{ input_key: "mass_flow", type: "monitored", datapoint_id: null, display_name: "Gas mass", quantity_kind: "mass" }],
  });
  expect(findUnbindableTemplateInputs(copy, { allowPeriodInputStub: true })).toEqual([]);
});

it("names unsupported metered inputs and their component", () => {
  const copy = structuredClone(template);
  const component = copy.groups.find((group) => group.key === "pyrolysis")!.components[0];
  component.blueprint_key = "metered_energy_based_ci_emissions";
  component.inputs = [{ input_key: "final_readout", type: "monitored", datapoint_id: null, display_name: "Final reading", quantity_kind: "energy" }];
  expect(formatUnbindableTemplateInputs(findUnbindableTemplateInputs(copy))).toBe(
    `The Removal template has 1 component noma cannot submit.\n${component.display_name}: Pick another Removal template or ask support to add the mapping.`,
  );
});

  it("reports renamed diesel components with the builder rename guidance", () => {
    const copy = structuredClone(template);
    const component = copy.groups.flatMap((group) => group.components).find((component) => component.display_name === "Generator diesel usage")!;
    component.display_name = "Renamed generator";
    const findings = findUnbindableTemplateInputs(copy);
    expect(findings).toMatchObject([{ reason: "unrecognized-component", componentId: component.id }]);
    expect(formatUnbindableTemplateInputs(findings)).toContain('Rename it in Isometric to one of these names: "Generator diesel usage", "Startup diesel usage".');
  });

  it.each([
    {
      groupKey: "biomass-feedstock-transport", blueprintKey: "transport", inputKey: "distance", reason: "unmapped",
      singular: "Replace it with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.",
      plural: "Replace each one with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.",
    },
    {
      groupKey: "direct-emissions", blueprintKey: "ghg_direct_emissions", inputKey: "mass_flow", reason: "project-scope",
      singular: "Add it as a project component in Isometric, then remove it from the Removal template.",
      plural: "Add each one as a project component in Isometric, then remove them from the Removal template.",
    },
    {
      groupKey: "miscellaneous", blueprintKey: "mass_based_ci_emissions", inputKey: "mass", reason: "project-scope",
      singular: 'This component can stay on the Removal only under its expected name. Rename it in Isometric to "Safety margin".',
      plural: 'These components can stay on the Removal only under their expected names. Rename each one in Isometric to "Safety margin".',
    },
    {
      groupKey: "pyrolysis", blueprintKey: "fuel_usage_by_volume", inputKey: "volume_of_fuel", reason: "unrecognized-component",
      singular: 'Rename it in Isometric to one of these names: "Generator diesel usage", "Startup diesel usage".',
      plural: 'Rename each one in Isometric to one of these names: "Generator diesel usage", "Startup diesel usage".',
    },
  ] as const)("agrees with the number of components for $blueprintKey", ({ singular, plural, ...tuple }) => {
    const input: UnbindableTemplateInput = { ...tuple, componentId: "a", componentDisplayName: "A" };
    expect(formatUnbindableTemplateInputs([input, input])).toBe(
      `The Removal template has 1 component noma cannot submit.\nA: ${singular}`,
    );
    expect(formatUnbindableTemplateInputs([input, { ...input, componentId: "b", componentDisplayName: "B" }])).toBe(
      `The Removal template has 2 components noma cannot submit.\nA and B: ${plural}`,
    );
  });

  it("reports unknown monitored storage inputs", () => {
    const copy = structuredClone(template);
    const component = copy.groups.flatMap((group) => group.components).find((component) => isSequestrationBlueprintFamily(component.blueprint_key))!;
    component.inputs.push({ ...component.inputs[0], input_key: "unknown_storage_input" });
    expect(findUnbindableTemplateInputs(copy)).toMatchObject([{ componentId: component.id, inputKey: "unknown_storage_input", reason: "unmapped" }]);
  });

  it("uses all for three ambiguous components and names each once", () => {
    const copy = structuredClone(template);
    const group = copy.groups.find((group) => group.key === "biochar-transport")!;
    const component = group.components[0];
    component.display_name = "A";
    group.components.push({ ...structuredClone(component), id: "b", display_name: "B" }, { ...structuredClone(component), id: "c", display_name: "C" });
    expect(formatUnbindableTemplateInputs(findUnbindableTemplateInputs(copy))).toContain("A, B and C would all receive");
  });
});
