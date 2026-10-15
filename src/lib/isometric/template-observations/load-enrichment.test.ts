import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import templateFixture from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { IsometricClient } from "../client";
import type { IsometricComponentBlueprint } from "../projects";
import type { Datapoint } from "../submissions";
import { loadTemplateEnrichment } from "./load-enrichment";
import { isEnrichmentComplete } from "./enrichment";
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
