import { describe, expect, it } from "vitest";
import sandbox from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { SafeError } from "@/lib/errors";
import { assignmentsFromPlan, setupPlan, sourcesTakenElsewhere, templateFitsFacility } from "./removal-template-setup-plan";
import { reviewLineSources } from "./removal-template-review-sources";
import { protocolDefaultFixture } from "./removal-template-setup-test-fixtures";

const template = sandbox as GhgEntryTemplate;
function planFor(value: GhgEntryTemplate) {
  const definition = normalizeTemplateDefinition(value);
  const sources = reviewLineSources(resolveLineSources({ definition }));
  return setupPlan(definition, sources, validateLineSources(definition, sources), {});
}

it("the October 15 sandbox bootstrap needs no decisions or assignments", () => {
  const plan = planFor(template);
  expect(plan.decisions).toEqual([]);
  expect(plan.defaults).toEqual([]);
  expect(assignmentsFromPlan(plan, {}, {})).toEqual({});
});

it("Protocol default asks for the electricity owner and the diesel source", () => {
  const plan = planFor(protocolDefaultFixture());
  expect(plan.decisions.map((decision) => decision.kind).sort()).toEqual(["clash", "source"]);
  const answers = Object.fromEntries(plan.decisions.map((decision) => [decision.id, decision.options[0].id]));
  const assignments = assignmentsFromPlan(plan, answers, {});
  expect(Object.values(assignments).filter((assignment) => assignment.automaticSource === "run-electricity")).toHaveLength(1);
  const definition = normalizeTemplateDefinition(protocolDefaultFixture());
  const sources = Object.fromEntries(Object.entries(assignments).map(([id, assignment]) => [id, { ...assignment, origin: "reviewed" as const }]));
  expect(validateLineSources(definition, sources)).toEqual([]);
});

it("an added component on a previously reviewed template needs an explicit answer", () => {
  const definition = normalizeTemplateDefinition(protocolDefaultFixture());
  const sources = resolveLineSources({ definition });
  const diesel = definition.groups.flatMap((group) => group.components).find((component) => component.blueprintKey === "fuel_usage_by_volume")!;
  const storage = definition.groups.find((group) => group.key === "co2-stored")!.components[0];
  sources[storage.id] = { ...sources[storage.id], origin: "reviewed" };
  const plan = setupPlan(definition, sources, validateLineSources(definition, sources), { [diesel.id]: "added" });
  expect(plan.decisions.find((decision) => decision.id === diesel.id)?.kind).toBe("added");
  expect(() => assignmentsFromPlan(plan, {}, {})).toThrow("Answer every");
});

it("offers entries for no candidate and no entry for fixed-only or unsupported shapes", () => {
  const definition = normalizeTemplateDefinition(protocolDefaultFixture());
  definition.groups = [{ ...definition.groups[0], key: "miscellaneous", components: [
    { id: "entry", displayName: "Entry", description: null, blueprintKey: "distance_based_ci_emissions", inputs: [{ key: "distance", type: "monitored", quantityKind: "distance" }] },
    { id: "fixed", displayName: "Fixed", description: null, blueprintKey: "unknown", inputs: [] },
    { id: "unsupported", displayName: "Unsupported", description: null, blueprintKey: "unknown", inputs: [{ key: "unknown", type: "monitored", quantityKind: "mass" }] },
  ] }];
  const sources = resolveLineSources({ definition });
  const plan = setupPlan(definition, sources, validateLineSources(definition, sources), {});
  expect(assignmentsFromPlan(plan, {}, {})).toEqual({
    entry: { scope: "operating", entryPolicy: "additive" },
    fixed: { scope: "operating", entryPolicy: "none" },
    unsupported: { scope: "operating", entryPolicy: "none" },
  });
  expect(() => assignmentsFromPlan(plan, {}, { entry: "invented" })).toThrow("offered option");
  expect(() => assignmentsFromPlan(plan, { unknown: "entry" }, {})).toThrow("offered");
  expect(() => assignmentsFromPlan(plan, {}, { unknown: "entry" })).toThrow("offered");
});

it("rejects an answer not offered by a decision", () => {
  const plan = planFor(protocolDefaultFixture());
  const answers = Object.fromEntries(plan.decisions.map((decision) => [decision.id, "forged"]));
  expect(() => assignmentsFromPlan(plan, answers, {})).toThrow("Answer every");
});

it("puts noma's existing proposal first for an added component without answering it", () => {
  const definition = normalizeTemplateDefinition(protocolDefaultFixture());
  const sources = resolveLineSources({ definition });
  const diesel = definition.groups.flatMap((group) => group.components).find((component) => component.blueprintKey === "fuel_usage_by_volume")!;
  const storage = definition.groups.find((group) => group.key === "co2-stored")!.components[0];
  sources[storage.id] = { ...sources[storage.id], origin: "reviewed" };
  sources[diesel.id] = { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive", origin: "proposed" };
  const plan = setupPlan(definition, sources, validateLineSources(definition, sources), { [diesel.id]: "added" });
  expect(plan.decisions.find((decision) => decision.id === diesel.id)?.options[0].id).toBe("run-startup-diesel");
  expect(() => assignmentsFromPlan(plan, {}, {})).toThrow("Answer every");
});

describe("sources shared by independent decisions", () => {
  function dieselPlan() {
    const candidate = protocolDefaultFixture();
    const pyrolysis = candidate.groups.find((group) => group.key === "pyrolysis")!;
    const diesel = pyrolysis.components.find((component) => component.blueprint_key === "fuel_usage_by_volume")!;
    candidate.groups = [{ ...pyrolysis, components: [diesel, { ...structuredClone(diesel), id: "diesel-second" }] }];
    return planFor(candidate);
  }

  it.each([
    ["run-genset-diesel", "Generator diesel from production runs"],
    ["run-startup-diesel", "Startup diesel from production runs"],
  ])("rejects two pending diesel components choosing %s", (source, label) => {
    const plan = dieselPlan();
    expect(plan.decisions.map((decision) => decision.kind)).toEqual(["source", "source"]);
    const answers = Object.fromEntries(plan.decisions.map((decision) => [decision.id, source]));
    const apply = () => assignmentsFromPlan(plan, answers, {});
    expect(apply).toThrow(SafeError);
    expect(apply).toThrow(`${label} is selected more than once. Each source can fill only one component. Choose a different source or Neither, entry.`);
  });

  it.each(["run-startup-diesel", "entry"])("accepts %s for the other diesel component", (otherSource) => {
    const plan = dieselPlan();
    const [first, second] = plan.decisions;
    const assignments = assignmentsFromPlan(plan, { [first.id]: "run-genset-diesel", [second.id]: otherSource }, {});
    expect(assignments[first.id].automaticSource).toBe("run-genset-diesel");
    expect(assignments[second.id].automaticSource).toBe(otherSource === "entry" ? undefined : otherSource);
  });

  it("checks selections against already decided components", () => {
    const plan = dieselPlan();
    const first = plan.decisions.shift()!;
    plan.decided.push({ ...first.components[0], contract: {
      scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "reviewed",
    } });
    const second = plan.decisions[0];
    expect(() => assignmentsFromPlan(plan, { [second.id]: "run-genset-diesel" }, {})).toThrow(SafeError);
    expect(sourcesTakenElsewhere(plan, {}, {}, second.id)).toEqual(new Set(["run-genset-diesel"]));
  });

  it("reports sources selected by other decisions while allowing incomplete answers", () => {
    const plan = dieselPlan();
    const [first, second] = plan.decisions;
    const before = structuredClone(plan);
    expect(sourcesTakenElsewhere(plan, {}, {}, second.id)).toEqual(new Set());
    const answers = { [first.id]: "run-genset-diesel" };
    expect(sourcesTakenElsewhere(plan, answers, {}, second.id)).toEqual(new Set(["run-genset-diesel"]));
    expect(sourcesTakenElsewhere(plan, answers, {}, first.id)).toEqual(new Set());
    expect(plan).toEqual(before);
  });

  it("uses default proposals and overrides, excluding the current component", () => {
    const plan = dieselPlan();
    const first = plan.decisions.shift()!;
    plan.defaults.push({ ...first.components[0], options: first.options, proposal: first.options[0] });
    const second = plan.decisions[0];
    expect(sourcesTakenElsewhere(plan, {}, {}, second.id)).toEqual(new Set(["run-genset-diesel"]));
    expect(sourcesTakenElsewhere(plan, {}, { [first.id]: "run-startup-diesel" }, second.id)).toEqual(new Set(["run-startup-diesel"]));
    expect(sourcesTakenElsewhere(plan, {}, { [first.id]: "entry" }, second.id)).toEqual(new Set());
    expect(sourcesTakenElsewhere(plan, {}, {}, first.id)).toEqual(new Set());
    expect(() => assignmentsFromPlan(plan, { [second.id]: "run-genset-diesel" }, {})).toThrow(SafeError);
  });

  it("excludes every component of the current joint decision", () => {
    const plan = dieselPlan();
    const [first, second] = plan.decisions;
    plan.decisions = [{ id: "joint", kind: "clash", components: [...first.components, ...second.components], options: [{
      id: "split", label: "Split", assignments: { ...first.options[0].assignments, ...second.options[1].assignments },
    }] }];
    expect(sourcesTakenElsewhere(plan, { joint: "split" }, {}, "joint")).toEqual(new Set());
    expect(sourcesTakenElsewhere(plan, { joint: "split" }, {}, first.id)).toEqual(new Set(["run-startup-diesel"]));
  });
});

describe("facility fit", () => {
  it.each(["200_year", "1000_year"] as const)("accepts every current %s storage shape only at its own tier", (tier) => {
    const keys = tier === "200_year" ? ["biochar_sequestration_200_year_c_org", "biochar_sequestration_200_year_unsampled"] : ["biochar_sequestration_1000_year_f_durable_max"];
    for (const key of keys) {
      const candidate = structuredClone(template);
      candidate.groups.find((group) => group.key === "co2-stored")!.components[0].blueprint_key = key;
      expect(templateFitsFacility(candidate, tier)).toEqual({ fits: true });
      expect(templateFitsFacility(candidate, tier === "200_year" ? "1000_year" : "200_year")).toHaveProperty("reason");
    }
  });
  it("refuses deprecated storage, reductions and missing storage", () => {
    const candidate = structuredClone(template);
    candidate.groups.find((group) => group.key === "co2-stored")!.components[0].blueprint_key = "biochar_sequestration_1000_year";
    expect(templateFitsFacility(candidate, "1000_year")).toHaveProperty("reason");
    expect(templateFitsFacility({ ...template, credit_type: "REDUCTION" }, "1000_year")).toHaveProperty("reason");
    expect(templateFitsFacility({ ...template, groups: template.groups.filter((group) => group.key !== "co2-stored") }, "1000_year")).toHaveProperty("reason");
  });
});
