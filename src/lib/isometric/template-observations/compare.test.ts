import { describe, expect, it } from "vitest";
import sandbox from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import cula from "../../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import {
  compareTemplateObservations, isEntryCompatible, normalizeTemplateDefinition,
  resolveLineSources, validateLineSources,
  type EntryLine, type GhgEntryTemplate, type TemplateObservation,
} from "./index";

function observation(template = sandbox as GhgEntryTemplate): TemplateObservation {
  return { definition: normalizeTemplateDefinition(template), enrichment: {} };
}
const GENSET = "rtc_1KWHFRM4GSBX5Y7A";

function generator(observed: TemplateObservation) {
  return observed.definition.groups.find((group) => group.key === "pyrolysis")!.components.find((component) => component.id === GENSET)!;
}

describe("template observation drift", () => {
  it("reports additions, removals, cosmetic renames, group moves and replaced ids", () => {
    const prev = observation();
    const next = structuredClone(prev);
    const moved = generator(next);
    const pyrolysis = next.definition.groups.find((group) => group.key === "pyrolysis")!;
    pyrolysis.components = pyrolysis.components.filter((component) => component.id !== moved.id);
    next.definition.groups.find((group) => group.key === "biochar-processing")!.components.push(moved);
    const transport = next.definition.groups.find((group) => group.key === "biomass-feedstock-transport")!.components[0];
    transport.displayName = "Renamed truck";
    const removedGroup = next.definition.groups.find((group) => group.key === "staff-travel")!;
    const [removed, replaced] = removedGroup.components;
    removedGroup.components = [{ ...replaced, id: "rtc_replacement" }];
    pyrolysis.components.push({ ...moved, id: "rtc_added" });
    const diff = compareTemplateObservations(prev, next);
    expect(diff[GENSET]).toBe("changed");
    expect(diff[transport.id]).toBe("cosmetic");
    expect(diff[removed.id]).toBe("removed");
    expect(diff[replaced.id]).toBe("removed");
    expect(diff.rtc_replacement).toBe("added");
    expect(diff.rtc_added).toBe("added");
    expect(diff.rtc_1M006YZ5CSBXJSWD).toBe("unchanged");
    const previous = { definition: prev.definition, lineSources: resolveLineSources({ definition: prev.definition }) };
    const sources = resolveLineSources({ definition: next.definition, previous });
    expect(sources[transport.id]).toMatchObject({ origin: "carried", automaticSource: "feedstock-transport" });
    expect(sources.rtc_replacement).toMatchObject({ origin: "proposed", scope: "unassigned" });
    expect(sources[replaced.id]).toBeUndefined();
  });

  it("reports a display-name-only diesel rename as cosmetic and keeps its id binding", () => {
    const prev = observation();
    const next = structuredClone(prev);
    generator(next).displayName = "Generator and preprocessing";
    expect(compareTemplateObservations(prev, next)[GENSET]).toBe("cosmetic");
    const previous = { definition: prev.definition, lineSources: resolveLineSources({ definition: prev.definition }) };
    expect(resolveLineSources({ definition: next.definition, previous })[GENSET].automaticSource).toBe("run-genset-diesel");
  });

  it("blocks a bootstrapped line with an unknown additional monitored input", () => {
    const prev = observation();
    const next = structuredClone(prev);
    generator(next).inputs.push({ key: "unknown_monitored_input", type: "monitored", quantityKind: "pressure" });
    expect(compareTemplateObservations(prev, next)[GENSET]).toBe("changed");
    const problems = validateLineSources(next.definition, resolveLineSources({ definition: next.definition }));
    expect(problems).toContainEqual({ code: "foreign-automatic-source", componentId: GENSET });
    expect(problems).toContainEqual({ code: "disallowed-entry-policy", componentId: GENSET });
  });

  it("detects group identity and key changes, and treats group descriptions as cosmetic", () => {
    const prev = observation();
    for (const field of ["id", "key", "description", "displayName"] as const) {
      const next = structuredClone(prev);
      const group = next.definition.groups.find((candidate) => candidate.key === "pyrolysis")!;
      group[field] = "changed";
      expect(compareTemplateObservations(prev, next)[GENSET]).toBe(field === "id" || field === "key" ? "changed" : "cosmetic");
    }
  });

  it("compares two facilities on different templates without leaking contracts or enrichment", () => {
    const first = observation();
    const second = observation(cula as GhgEntryTemplate);
    const firstSources = resolveLineSources({ definition: first.definition });
    const secondSources = resolveLineSources({ definition: second.definition });
    firstSources[GENSET].scope = "forbidden";
    expect(resolveLineSources({ definition: first.definition })[GENSET].scope).toBe("operating");
    expect(secondSources[GENSET]).toBeUndefined();
    const changed = structuredClone(first);
    changed.enrichment[GENSET] = { volume_of_fuel: { unit: "l" } };
    expect(compareTemplateObservations(first, changed)[GENSET]).toBe("changed");
    expect(new Set(Object.values(compareTemplateObservations(second, structuredClone(second))))).toEqual(new Set(["unchanged"]));
  });
});

function entryLine(): EntryLine {
  return {
    component: {
      id: "rtc_entry", displayName: "Entry", description: null, blueprintKey: "mass_based_ci_emissions",
      inputs: [{ key: "mass", type: "monitored", quantityKind: "mass" }],
    },
    entryPolicy: "additive",
    enrichment: { mass: { unit: "kg" } },
  };
}

describe("entry compatibility after a template change", () => {
  it("permits convertible units and ignores names and fixed-factor identity changes", () => {
    const prev = entryLine();
    prev.component.inputs.push({ key: "carbon_intensity", type: "fixed", quantityKind: "mass_carbon_emission_factor", fixedDatapointId: "dtp_old" });
    prev.enrichment.carbon_intensity = { unit: "kgCO2e / kg", fixedValue: 1 };
    const next = structuredClone(prev);
    next.enrichment.mass = { unit: "tonne" };
    next.component.displayName = "Renamed";
    next.component.inputs.reverse()[0].fixedDatapointId = "dtp_replacement";
    next.enrichment.carbon_intensity = { unit: "kgCO2e / kg", fixedValue: 2 };
    expect(isEntryCompatible(prev, next)).toBe(true);
  });

  it.each(["key", "quantity", "unit", "policy", "unknown", "missing", "input-type", "added"])("refuses incompatible %s changes", (change) => {
    const prev = entryLine();
    const next = structuredClone(prev);
    if (change === "key") next.component.inputs[0].key = "other";
    if (change === "quantity") next.component.inputs[0].quantityKind = "energy";
    if (change === "unit") next.enrichment.mass = { unit: "mystery" };
    if (change === "policy") next.entryPolicy = "single";
    if (change === "unknown") next.enrichment.mass = { status: "unknown" };
    if (change === "missing") delete next.enrichment.mass;
    if (change === "input-type") next.component.inputs[0].type = "fixed";
    if (change === "added") next.component.inputs.push({ key: "extra", type: "monitored", quantityKind: "mass" });
    expect(isEntryCompatible(prev, next)).toBe(false);
  });
});
