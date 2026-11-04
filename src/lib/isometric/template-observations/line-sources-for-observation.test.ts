import { describe, expect, it } from "vitest";
import { fullFingerprint, semanticFingerprint } from "./fingerprints";
import { lineSourcesForObservation } from "./line-sources-for-observation";
import type { LineSources } from "./line-sources";
import type { TemplateDefinition, TemplateEnrichment } from "./types";

const definition: TemplateDefinition = { groups: [{
  id: "group", key: "pyrolysis", displayName: "Pyrolysis", description: "",
  components: [{ id: "electricity", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
    inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }],
}] };
const enrichment: TemplateEnrichment = { electricity: { electricity_use: { unit: "kWh" } } };
const lineSources: LineSources = { electricity: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "none", origin: "reviewed" } };
const latest = {
  definition, lineSources,
  semanticFingerprint: semanticFingerprint(definition, enrichment),
  fullFingerprint: fullFingerprint(definition, enrichment),
};

describe("lineSourcesForObservation", () => {
  it("keeps latest contracts when both fingerprints match without mutating them", () => {
    const before = structuredClone(latest);
    expect(lineSourcesForObservation({ definition, enrichment, latest })).toEqual(lineSources);
    expect(latest).toEqual(before);
  });

  it("resolves from latest when the definition is equal but enrichment changes", () => {
    const changed: TemplateEnrichment = { electricity: { electricity_use: { unit: "MWh" } } };
    expect(lineSourcesForObservation({ definition, enrichment: changed, latest }).electricity)
      .toEqual({ ...lineSources.electricity, origin: "carried" });
  });

  it.each(["semanticFingerprint", "fullFingerprint"] as const)("requires a matching %s independently", (fingerprint) => {
    expect(lineSourcesForObservation({ definition, enrichment, latest: { ...latest, [fingerprint]: "different" } }).electricity.origin)
      .toBe("carried");
  });

  it("resolves proposals without a latest observation", () => {
    expect(lineSourcesForObservation({ definition, enrichment })).toEqual({
      electricity: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "additive", origin: "proposed" },
    });
  });
});


it.each(["bootstrap", "proposed", "reviewed", "carried"] as const)("preserves admin decisions on unchanged observations: %s", (origin) => {
  const definition: TemplateDefinition = { groups: [{ id: "g", key: "biomass-feedstock-transport", displayName: "Transport", description: "",
    components: [{ id: "transport", blueprintKey: "transport", displayName: "Transport", description: null, inputs: [
      { key: "mass", type: "monitored", quantityKind: "mass" }, { key: "distance", type: "monitored", quantityKind: "distance" },
    ] }] }] };
  const enrichment = {};
  const lineSources: LineSources = { transport: { scope: "operating", automaticSource: "feedstock-transport", entryPolicy: "additive", origin } };
  const latest = { definition, lineSources, semanticFingerprint: semanticFingerprint(definition, enrichment), fullFingerprint: fullFingerprint(definition, enrichment) };
  expect(lineSourcesForObservation({ definition, enrichment, latest }).transport.entryPolicy).toBe(origin === "bootstrap" || origin === "proposed" ? "none" : "additive");
  expect(latest.lineSources.transport.entryPolicy).toBe("additive");
});
