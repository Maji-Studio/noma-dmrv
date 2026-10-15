import { describe, expect, it } from "vitest";
import sandbox from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { components } from "../generated/certify";
import { canonicalDecimal, enrichmentProblems, fullFingerprint, isEnrichmentComplete, normalizeTemplateDefinition, semanticFingerprint, type TemplateEnrichment } from "./index";

type Template = components["schemas"]["GhgEntryTemplate"];
const fixture = (): Template => structuredClone(sandbox) as Template;

describe("template definitions", () => {
  it("normalizes the REST template into sorted groups, components and inputs", () => {
    const definition = normalizeTemplateDefinition(fixture());
    const pyrolysis = definition.groups.find((group) => group.key === "pyrolysis")!;
    expect(pyrolysis.components[0]).toMatchObject({
      id: "rtc_1KVFZ1MY9SBXFWVN",
      displayName: "Metered electricity use emissions",
      blueprintKey: "grid_electricity_use",
      inputs: [
        { key: "electricity_use", type: "monitored", quantityKind: "energy" },
        { key: "grid_carbon_intensity", type: "fixed", quantityKind: "energy_carbon_emission_factor" },
      ],
    });
    expect(pyrolysis.components[0].inputs[1].fixedDatapointId).toMatch(/^dtp_/);
    const reversed = fixture();
    reversed.groups.reverse().forEach((group) => group.components.reverse().forEach((component) => component.inputs.reverse()));
    expect(normalizeTemplateDefinition(reversed)).toEqual(definition);
    expect(sandbox.groups[0].key).toBe("biomass-feedstock-sourcing");
  });
});

describe("template fingerprints and enrichment", () => {
  it("ignores ordering and canonicalizes decimal magnitudes and unit spellings", () => {
    const definition = normalizeTemplateDefinition(fixture());
    const enrichment: TemplateEnrichment = {
      rtc_1KWHFRM4GSBX5Y7A: {
        volume_of_fuel: { unit: "L" },
        fuel_combustion_carbon_intensity: { unit: "kgCO2e / l", fixedValue: "002.5000e+0", deprecated: false },
      },
    };
    const reordered = structuredClone(definition);
    reordered.groups.reverse().forEach((group) => group.components.reverse().forEach((component) => component.inputs.reverse()));
    const equivalent = structuredClone(enrichment);
    equivalent.rtc_1KWHFRM4GSBX5Y7A.fuel_combustion_carbon_intensity = { unit: "kgCO2e / l", fixedValue: 2.5 };
    expect(semanticFingerprint(reordered, equivalent)).toBe(semanticFingerprint(definition, enrichment));
    expect(fullFingerprint(reordered, equivalent)).toBe(fullFingerprint(definition, enrichment));
    expect(semanticFingerprint(definition, enrichment)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalDecimal("1.2300e-7")).toBe("0.000000123");
    expect(canonicalDecimal("-0.000")).toBe("0");
    expect(canonicalDecimal(".500")).toBe("0.5");
    expect(canonicalDecimal("9007199254740993.0100")).toBe("9007199254740993.01");
  });

  it("hashes descriptions only in the full fingerprint, and units and fixed values semantically", () => {
    const definition = normalizeTemplateDefinition(fixture());
    const renamed = structuredClone(definition);
    renamed.groups[0].description = "Updated group description";
    renamed.groups[0].components[0].description = "Updated component description";
    expect(semanticFingerprint(renamed, {})).toBe(semanticFingerprint(definition, {}));
    expect(fullFingerprint(renamed, {})).not.toBe(fullFingerprint(definition, {}));
    const component = definition.groups[0].components[0];
    const enrichment: TemplateEnrichment = { [component.id]: { carbon_intensity: { unit: "kgCO2e / (tonne * km)", fixedValue: 1 } } };
    const changed = structuredClone(enrichment);
    changed[component.id].carbon_intensity = { unit: "kgCO2e / (tonne * km)", fixedValue: "1.1" };
    expect(semanticFingerprint(definition, changed)).not.toBe(semanticFingerprint(definition, enrichment));
    changed[component.id].carbon_intensity = { unit: "kgCO2e / (kg * km)", fixedValue: 1 };
    expect(semanticFingerprint(definition, changed)).not.toBe(semanticFingerprint(definition, enrichment));
  });


  it.each(["blueprint", "input-key", "input-type", "quantity-kind", "fixed-datapoint"])("fingerprints semantic %s changes", (change) => {
    const definition = normalizeTemplateDefinition(fixture());
    const next = structuredClone(definition);
    const line = next.groups.find((group) => group.key === "pyrolysis")!.components[0];
    if (change === "blueprint") line.blueprintKey = "replacement_blueprint";
    if (change === "input-key") line.inputs[0].key = "replacement_input";
    if (change === "input-type") line.inputs[0].type = "fixed";
    if (change === "quantity-kind") line.inputs[0].quantityKind = "volume";
    if (change === "fixed-datapoint") line.inputs[1].fixedDatapointId = "dtp_replacement";
    expect(semanticFingerprint(next, {})).not.toBe(semanticFingerprint(definition, {}));
  });

  it("requires every fixed value and monitored unit, exposing unknown units per line", () => {
    const template = fixture();
    template.groups = template.groups.filter((group) => group.key === "pyrolysis");
    template.groups[0].components = template.groups[0].components.filter((component) => component.blueprint_key === "grid_electricity_use");
    const definition = normalizeTemplateDefinition(template);
    const id = definition.groups[0].components[0].id;
    const enrichment: TemplateEnrichment = { [id]: {
      electricity_use: { unit: "kWh" },
      grid_carbon_intensity: { unit: "kgCO2e / kWh", fixedValue: "0", deprecated: true },
    } };
    expect(isEnrichmentComplete(definition, enrichment)).toBe(true);
    expect(enrichmentProblems(definition, enrichment)).toEqual([]);
    enrichment[id].electricity_use = { unit: "mystery" };
    expect(isEnrichmentComplete(definition, enrichment)).toBe(false);
    expect(enrichmentProblems(definition, enrichment)).toContainEqual({ code: "unknown-unit", componentId: id, inputKey: "electricity_use" });
    enrichment[id].electricity_use = { status: "unknown" };
    enrichment[id].grid_carbon_intensity = { unit: "kgCO2e / kWh" };
    expect(enrichmentProblems(definition, enrichment).map((problem) => problem.code)).toEqual(["unknown-enrichment", "missing-fixed-value"]);
  });
});
