import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import templateFixture from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { IsometricClient } from "../client";
import type { IsometricComponentBlueprint } from "../projects";
import type { Datapoint } from "../submissions";
import { loadTemplateEnrichment } from "./load-enrichment";
import { isEnrichmentComplete } from "./enrichment";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "../storage-blueprints";
import { normalizeTemplateDefinition } from "./normalize";
import { canonicalUnit, unitsConvertible } from "./units";
import type { GhgEntryTemplate } from "./types";

const template = templateFixture as GhgEntryTemplate;
const blueprints = fixture.blueprints as IsometricComponentBlueprint[];
const datapoints = fixture.datapoints as Record<string, Datapoint>;
function client(failId?: string) {
  const get = vi.fn(async (path: string) => {
    const id = path.split("/").at(-1)!;
    if (id === failId) throw new Error("Unavailable");
    return datapoints[id];
  });
  return { get, api: { get } as unknown as IsometricClient };
}

describe("real template enrichment", () => {
  it("recognizes every blueprint compatible unit for its quantity kind", () => {
    for (const blueprint of blueprints) for (const input of blueprint.inputs) {
      expect(canonicalUnit(input.quantity_kind, input.compatible_unit), `${blueprint.key}/${input.input_key}`).toBeDefined();
    }
  });
  it("reads the full 15 Oct template, including all REST fixed units", async () => {
    const { api, get } = client();
    const enrichment = await loadTemplateEnrichment(api, template, blueprints);
    const definition = normalizeTemplateDefinition(template);
    expect(isEnrichmentComplete(definition, enrichment)).toBe(true);
    const fixedIds = new Set(definition.groups.flatMap((group) => group.components.flatMap((component) =>
      component.inputs.flatMap((input) => input.fixedDatapointId ? [input.fixedDatapointId] : []),
    )));
    expect(get).toHaveBeenCalledTimes(fixedIds.size);
    for (const group of definition.groups) for (const component of group.components) for (const input of component.inputs) {
      const enriched = enrichment[component.id][input.key];
      expect("status" in enriched).toBe(false);
      if (!("status" in enriched)) {
        expect(canonicalUnit(input.quantityKind, enriched.unit)).toBeDefined();
        expect(enriched.deprecated).toBeNull();
      }
    }
  });
  it("keeps failed reads unknown and other inputs usable", async () => {
    const failedId = Object.keys(datapoints)[0];
    const { api } = client(failedId);
    const enrichment = await loadTemplateEnrichment(api, template, blueprints);
    const definition = normalizeTemplateDefinition(template);
    expect(isEnrichmentComplete(definition, enrichment)).toBe(false);
    for (const group of definition.groups) for (const component of group.components) for (const input of component.inputs) {
      if (input.fixedDatapointId === failedId) expect(enrichment[component.id][input.key]).toEqual({ status: "unknown" });
      else expect(enrichment[component.id][input.key]).not.toHaveProperty("status");
    }
  });
});

it("parses products, chained division, parentheses, dimensions and scales", () => {
  const kind = "mass_distance_carbon_emission_factor";
  expect(canonicalUnit(kind, "kgCO2e / kilometer / metric_ton")).toBe(canonicalUnit(kind, "kgCO2e / (tonne * km)"));
  expect(canonicalUnit(kind, "kgCO2e / kilometer / metric_ton")).not.toBe(canonicalUnit(kind, "gCO2e / (tonne * km)"));
  expect(unitsConvertible(kind, "gCO2e / (tonne * km)", "kgCO2e / kilogram / m")).toBe(true);
  expect(canonicalUnit("mass", "kg / km")).toBeUndefined();
  expect(canonicalUnit("mass", "unknown")).toBeUndefined();
  expect(canonicalUnit("mass", "(kg")).toBeUndefined();
  expect(canonicalUnit("mass", "kg nonsense")).toBeUndefined();
  expect(canonicalUnit("mass", "kg / )")).toBeUndefined();
});

it("enriches the exact supported sequestration inputs when its blueprint is omitted", async () => {
  const component = template.groups.flatMap((group) => group.components).find((line) => line.blueprint_key === CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR)!;
  expect(component.inputs.map((input) => input.input_key).sort()).toEqual(["inorganic_carbon_contents", "product_mass", "s_fraction", "total_carbon_contents"]);
  const omitted = blueprints.filter((blueprint) => blueprint.key !== CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR);
  const { api } = client();
  const enrichment = await loadTemplateEnrichment(api, template, omitted);
  expect(isEnrichmentComplete(normalizeTemplateDefinition(template), enrichment)).toBe(true);
  expect(enrichment[component.id].product_mass).toMatchObject({ unit: "kg" });
  for (const key of ["total_carbon_contents", "inorganic_carbon_contents", "s_fraction"]) {
    expect(enrichment[component.id][key]).toMatchObject({ unit: "dimensionless" });
  }
  const drifted = structuredClone(template);
  const changed = drifted.groups.flatMap((group) => group.components).find((line) => line.id === component.id)!;
  changed.inputs.find((input) => input.input_key === "product_mass")!.quantity_kind = "volume";
  changed.inputs.push({ ...changed.inputs[0], input_key: "unknown_input" });
  const driftedEnrichment = await loadTemplateEnrichment(api, drifted, omitted);
  expect(driftedEnrichment[component.id].product_mass).toEqual({ status: "unknown" });
  expect(driftedEnrichment[component.id].unknown_input).toEqual({ status: "unknown" });
  expect(isEnrichmentComplete(normalizeTemplateDefinition(drifted), driftedEnrichment)).toBe(false);
});
