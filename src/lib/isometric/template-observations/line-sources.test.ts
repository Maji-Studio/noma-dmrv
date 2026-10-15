import { describe, expect, it } from "vitest";
import sandbox from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import cula from "../../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import production from "../../../../tests/fixtures/isometric/production-template-2026-07-03.json";
import olderSandbox from "../../../../tests/fixtures/isometric/sandbox-template.json";
import { acceptAllProposals } from "./test-support";
import {
  AUTOMATIC_SOURCE_IDS, allowedEntryPolicies, catalogCandidates, effectiveContract,
  normalizeTemplateDefinition, resolveLineSources, validateLineSources,
  type GhgEntryTemplate, type LineSources, type TemplateComponent,
} from "./index";

const definitions = [sandbox, cula, production, olderSandbox].map((fixture) => normalizeTemplateDefinition(fixture as GhgEntryTemplate));
const definition = definitions[0];
const components = definition.groups.flatMap((group) => group.components);
const component = (id: string) => components.find((line) => line.id === id)!;
const GENSET = "rtc_1KWHFRM4GSBX5Y7A";
const STARTUP = "rtc_1KWP4Y13JSBXV8FB";

function adHoc(blueprintKey: string, inputs: TemplateComponent["inputs"]): TemplateComponent {
  return { id: "rtc_new", displayName: "New line", description: null, blueprintKey, inputs };
}

describe("line contracts", () => {
  it.each(definitions)("bootstraps every fixture component with valid contracts", (fixtureDefinition) => {
    const sources = resolveLineSources({ definition: fixtureDefinition });
    const ids = fixtureDefinition.groups.flatMap((group) => group.components.map((line) => line.id));
    expect(Object.keys(sources).sort()).toEqual(ids.sort());
    expect(Object.values(sources).every((contract) => contract.origin === "bootstrap")).toBe(true);
    expect(validateLineSources(fixtureDefinition, sources)).toEqual([]);
  });

  it("assigns diesel by component id, keeping the October sample lines entry-only", () => {
    const sources = resolveLineSources({ definition });
    expect(sources[GENSET]).toEqual({ scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "bootstrap" });
    expect(sources[STARTUP].automaticSource).toBe("run-startup-diesel");
    expect(sources.rtc_1KVFZ1MY9SBXFWVN.automaticSource).toBe("run-electricity");
    for (const id of ["rtc_1M4ZRPH1RSBXADG2", "rtc_1M4ZRRN6PSBXHQ7C"]) {
      expect(sources[id]).toEqual({ scope: "operating", entryPolicy: "additive", origin: "bootstrap" });
    }
    expect(sources.rtc_1M4ZRBJ4GSBXWASX.entryPolicy).toBe("single");
    expect(sources.rtc_1M006YZ5CSBXJSWD).toMatchObject({ automaticSource: "sequestration", entryPolicy: "none" });
    expect(validateLineSources(definition, sources).some((problem) => problem.code === "ambiguous")).toBe(false);
    expect(resolveLineSources({ definition: definitions[1] }).rtc_1M2QJGQS21S04PBN).toEqual({ scope: "operating", entryPolicy: "single", origin: "bootstrap" });
  });

  it("derives catalog choices without relying on display names", () => {
    expect(catalogCandidates(component(GENSET), "pyrolysis")).toEqual(["run-genset-diesel", "run-startup-diesel"]);
    expect(catalogCandidates(component(GENSET), "biochar-storage")).toEqual([]);
    const truck = definitions[1].groups.find((group) => group.key === "biomass-feedstock-transport")!.components[0];
    expect(catalogCandidates(truck, "biomass-feedstock-transport")).toEqual(["feedstock-transport"]);
    const safety = adHoc("mass_based_ci_emissions", [{ key: "mass", quantityKind: "mass", type: "monitored" }]);
    expect(catalogCandidates(safety, "miscellaneous")).toEqual(["safety-margin"]);
  });

  it("allows only supported monitored input shapes", () => {
    expect(allowedEntryPolicies(component(GENSET))).toEqual(["none", "additive"]);
    expect(allowedEntryPolicies(component("rtc_1M4ZRBJ4GSBXWASX"))).toEqual(["none", "single"]);
    const meter = definitions[1].groups.find((group) => group.key === "pyrolysis")!.components.find((line) => line.blueprintKey === "metered_energy_based_ci_emissions")!;
    expect(allowedEntryPolicies(meter)).toEqual(["none", "single"]);
    expect(allowedEntryPolicies(adHoc("future", [{ key: "pressure", type: "monitored", quantityKind: "pressure" }]))).toEqual(["none"]);
    expect(allowedEntryPolicies(adHoc("future", [{ key: "unknown", type: "monitored", quantityKind: "volume" }]))).toEqual(["none"]);
    expect(allowedEntryPolicies({ ...meter, inputs: meter.inputs.filter((input) => input.key !== "final_readout") })).toEqual(["none"]);
    expect(allowedEntryPolicies({ ...component(GENSET), inputs: [...component(GENSET).inputs, { key: "future", type: "monitored", quantityKind: "volume" }] })).toEqual(["none"]);
  });

  it("reports single with automatic source, source clashes, foreign sources and disallowed policies", () => {
    const sources = resolveLineSources({ definition });
    sources[GENSET].entryPolicy = "single";
    sources[STARTUP].automaticSource = "run-genset-diesel";
    sources.rtc_1KVFZ1MY9SBXFWVN.automaticSource = "sample-transport";
    const problems = validateLineSources(definition, sources);
    expect(problems).toContainEqual({ code: "single-with-automatic-source", componentId: GENSET });
    expect(problems).toContainEqual({ code: "disallowed-entry-policy", componentId: GENSET });
    expect(problems).toContainEqual({ code: "foreign-automatic-source", componentId: "rtc_1KVFZ1MY9SBXFWVN" });
    expect(problems.filter((problem) => problem.code === "ambiguous").map((problem) => problem.componentId).sort()).toEqual([GENSET, STARTUP].sort());
  });

  it("reports missing and unassigned contracts", () => {
    const sources = resolveLineSources({ definition });
    delete sources[GENSET];
    sources[STARTUP].scope = "unassigned";
    expect(validateLineSources(definition, sources)).toContainEqual({ code: "missing-contract", componentId: GENSET });
    expect(validateLineSources(definition, sources)).toContainEqual({ code: "unassigned", componentId: STARTUP });
  });

  it("carries surviving ids and proposes only unambiguous catalog bindings", () => {
    const next = structuredClone(definition);
    const pyrolysis = next.groups.find((group) => group.key === "pyrolysis")!;
    pyrolysis.components.find((line) => line.id === GENSET)!.displayName = "Renamed generator";
    pyrolysis.components.push({ ...component(GENSET), id: "rtc_new_diesel" });
    pyrolysis.components.push({ ...component("rtc_1KVFZ1MY9SBXFWVN"), id: "rtc_new_electricity" });
    const previous = { definition, lineSources: resolveLineSources({ definition }) };
    const sources = resolveLineSources({ definition: next, previous });
    expect(sources[GENSET]).toMatchObject({ origin: "carried", automaticSource: "run-genset-diesel" });
    expect(sources.rtc_new_diesel.scope).toBe("unassigned");
    expect(sources.rtc_new_electricity).toEqual({ scope: "operating", automaticSource: "run-electricity", entryPolicy: "additive", origin: "proposed" });
    expect(effectiveContract(sources.rtc_new_electricity)).toMatchObject({ scope: "unassigned", entryPolicy: "none" });
    expect(effectiveContract(sources.rtc_new_electricity).automaticSource).toBeUndefined();
    expect(validateLineSources(next, sources)).toContainEqual({ code: "unassigned", componentId: "rtc_new_electricity" });
    expect(acceptAllProposals(sources).rtc_new_electricity.origin).toBe("reviewed");
    expect(sources.rtc_new_electricity.origin).toBe("proposed");
    expect(previous.lineSources[GENSET].origin).toBe("bootstrap");
  });


  it("lists stable IDs only for sources present in the catalog", () => {
    expect(AUTOMATIC_SOURCE_IDS).toEqual([
      "biochar-dry-mass", "delivery-transport", "feedstock-dry-mass", "feedstock-transport",
      "run-electricity", "run-genset-diesel", "run-startup-diesel", "safety-margin", "sample-transport", "sequestration",
    ]);
    const volumeBased = adHoc("specific_volume_based_emissions", [{ key: "feedstock_mass", type: "monitored", quantityKind: "mass" }]);
    expect(catalogCandidates(volumeBased, "biomass-feedstock-transport")).toEqual(["feedstock-dry-mass"]);
    expect(catalogCandidates(volumeBased, "biochar-transport")).toEqual(["biochar-dry-mass"]);
  });

  it("does not accept a pending proposal on a subsequent observation", () => {
    const next = structuredClone(definition);
    const group = next.groups.find((candidate) => candidate.key === "pyrolysis")!;
    group.components = [{ ...component("rtc_1KVFZ1MY9SBXFWVN"), id: "rtc_new_electricity" }];
    const first = resolveLineSources({ definition: next });
    const second = resolveLineSources({ definition: next, previous: { definition: next, lineSources: first } });
    expect(second.rtc_new_electricity.origin).toBe("proposed");
    expect(effectiveContract(second.rtc_new_electricity).scope).toBe("unassigned");
  });

  it("never carries a stale contract for an id absent from the previous definition", () => {
    const sources: LineSources = { rtc_new: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "additive", origin: "reviewed" } };
    const next = { groups: [{ ...definition.groups.find((group) => group.key === "pyrolysis")!, components: [{ ...component(GENSET), id: "rtc_new" }] }] };
    expect(resolveLineSources({ definition: next, previous: { definition: { groups: [] }, lineSources: sources } }).rtc_new.scope).toBe("unassigned");
  });
});
