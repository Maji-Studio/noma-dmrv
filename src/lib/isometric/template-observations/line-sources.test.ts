import { describe, expect, it } from "vitest";
import sandbox from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import cula from "../../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import production from "../../../../tests/fixtures/isometric/production-template-2026-07-03.json";
import olderSandbox from "../../../../tests/fixtures/isometric/sandbox-template.json";
import { acceptAllProposals } from "./test-support";
import {
  lineNeedsReview, AUTOMATIC_SOURCE_IDS, allowedEntryPolicies, catalogCandidates, effectiveContract,
  isAcceptableProposal, normalizeTemplateDefinition, resolveLineSources, validateLineSources,
  type GhgEntryTemplate, type LineContract, type LineSources, type TemplateComponent,
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
    pyrolysis.components = pyrolysis.components.filter((line) => line.id !== "rtc_1KVFZ1MY9SBXFWVN");
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

describe("acceptable proposals", () => {
  const group = definitions[1].groups.find((candidate) => candidate.key === "biomass-feedstock-transport")!;
  const trucks = [
    { ...group.components[0], id: "rtc_new_truck", displayName: "Biomass transportation to processing site via truck" },
    { ...group.components[0], id: "rtc_last_mile", displayName: "Last mile feedstock transport" },
  ];
  const shared = { groups: [{ ...group, components: trucks }] };
  const lone = { groups: [{ ...group, components: [trucks[0]] }] };
  const proposal: LineContract = { scope: "operating", automaticSource: "feedstock-transport", entryPolicy: "additive", origin: "proposed" };
  const unassigned: LineContract = { scope: "unassigned", entryPolicy: "none", origin: "proposed" };

  it("drops both fresh proposals sharing their only catalog candidate", () => {
    const sources = resolveLineSources({ definition: shared });
    for (const truck of trucks) {
      expect(truck.blueprintKey).toBe("transport");
      expect(truck.inputs.filter((input) => input.type === "monitored")).toEqual([
        { key: "distance", quantityKind: "distance", type: "monitored" },
        { key: "mass", quantityKind: "mass", type: "monitored" },
      ]);
      expect(catalogCandidates(truck, group.key)).toEqual(["feedstock-transport"]);
      expect(sources[truck.id]).toEqual(unassigned);
      expect(sources[truck.id].automaticSource).toBeUndefined();
      expect(isAcceptableProposal(shared, sources, truck.id)).toBe(false);
    }
    expect(validateLineSources(shared, sources).filter((problem) => problem.code === "ambiguous")).toEqual([]);
  });

  it("drops a new proposal while preserving the settled owner", () => {
    const settled = { groups: [group] };
    const original = resolveLineSources({ definition: settled });
    const next = { groups: [{ ...group, components: [...group.components, trucks[0]] }] };
    const sources = resolveLineSources({ definition: next });
    expect(catalogCandidates(trucks[0], group.key)).toEqual(["feedstock-transport"]);
    expect(original[group.components[0].id]).toMatchObject({ origin: "bootstrap", automaticSource: "feedstock-transport" });
    expect(sources[group.components[0].id]).toEqual(original[group.components[0].id]);
    expect(sources[trucks[0].id]).toEqual(unassigned);
    expect(validateLineSources(next, sources).filter((problem) => problem.code !== "unassigned")).toEqual([]);
  });

  it("drops colliding pending proposals carried from an older observation, retaining order", () => {
    const templateOrder = { groupPosition: 0, position: 0 };
    const previous = { definition: shared, lineSources: {
      [trucks[0].id]: { ...proposal, templateOrder },
      [trucks[1].id]: { ...proposal },
    } };
    const before = structuredClone(previous);
    const sources = resolveLineSources({ definition: shared, previous });
    expect(sources[trucks[0].id]).toEqual({ ...unassigned, templateOrder });
    expect(sources[trucks[1].id]).toEqual(unassigned);
    expect(previous).toEqual(before);
  });

  it("keeps a lone new proposal with an unshared candidate", () => {
    const sources = resolveLineSources({ definition: lone });
    expect(sources[trucks[0].id]).toEqual(proposal);
    expect(isAcceptableProposal(lone, sources, trucks[0].id)).toBe(true);
  });

  it("drops a carried proposal with a single entry policy and automatic figure", () => {
    const previous = { definition: lone, lineSources: { [trucks[0].id]: { ...proposal, entryPolicy: "single" as const } } };
    expect(isAcceptableProposal(lone, previous.lineSources, trucks[0].id)).toBe(false);
    expect(resolveLineSources({ definition: lone, previous })[trucks[0].id]).toEqual(unassigned);
  });

  it("checks only pending assigned proposals without mutating the input", () => {
    const sources: LineSources = { [trucks[0].id]: { ...proposal } };
    const before = structuredClone(sources);
    expect(isAcceptableProposal(lone, sources, "rtc_missing")).toBe(false);
    expect(isAcceptableProposal(lone, sources, "toString")).toBe(false);
    expect(isAcceptableProposal(lone, sources, trucks[0].id)).toBe(true);
    expect(sources).toEqual(before);
    for (const origin of ["bootstrap", "carried", "reviewed"] as const) {
      expect(isAcceptableProposal(lone, { [trucks[0].id]: { ...proposal, origin } }, trucks[0].id)).toBe(false);
    }
    expect(isAcceptableProposal(lone, { [trucks[0].id]: unassigned }, trucks[0].id)).toBe(false);
    for (const origin of ["proposed", "reviewed"] as const) {
      const collision = { ...sources, [trucks[1].id]: { ...proposal, origin } };
      const beforeCollision = structuredClone(collision);
      expect(isAcceptableProposal(shared, collision, trucks[0].id)).toBe(false);
      expect(collision).toEqual(beforeCollision);
    }
  });

  it("allows all acceptable proposals to be accepted together", () => {
    const next = { groups: [
      ...shared.groups,
      { ...definition.groups.find((candidate) => candidate.key === "biochar-transport")!, components: [{ ...trucks[0], id: "rtc_delivery" }] },
      { ...definition.groups.find((candidate) => candidate.key === "pyrolysis")!, components: [{ ...component("rtc_1KVFZ1MY9SBXFWVN"), id: "rtc_electricity" }] },
    ] };
    const sources = resolveLineSources({ definition: next });
    const acceptable = Object.fromEntries(Object.entries(sources).filter(([id]) => isAcceptableProposal(next, sources, id)));
    expect(Object.keys(acceptable).sort()).toEqual(["rtc_delivery", "rtc_electricity"]);
    const accepted = { ...sources, ...acceptAllProposals(acceptable) };
    expect(validateLineSources(next, accepted).filter((problem) => problem.code !== "unassigned")).toEqual([]);
  });
});

describe("lineNeedsReview", () => {
  it.each(["bootstrap", "carried", "reviewed"] as const)("protects a settled %s contract", (origin) => {
    const contract = { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin } as const;
    expect(lineNeedsReview(GENSET, contract, [])).toBe(false);
    expect(lineNeedsReview(GENSET, contract, [{ componentId: STARTUP, code: "ambiguous" }])).toBe(false);
    expect(lineNeedsReview(GENSET, contract, [{ componentId: GENSET, code: "ambiguous" }])).toBe(true);
    expect(lineNeedsReview(GENSET, { ...contract, scope: "unassigned" }, [])).toBe(true);
  });
  it("allows missing contracts and proposals", () => {
    expect(lineNeedsReview(GENSET, undefined, [])).toBe(true);
    expect(lineNeedsReview(GENSET, { scope: "operating", entryPolicy: "none", origin: "proposed" }, [])).toBe(true);
  });
});
