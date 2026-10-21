import { describe, expect, it } from "vitest";
import { dieselSource, electricityClash, startupDefault, template } from "@/components/certification/removal-template-setup/test-support";
import { decisionQuestion, decisionSituation, entryCount, openDecisions, notOfferedReason, optionLabel, startState } from "./removal-template-setup-copy";

describe("removal template setup copy", () => {
  it("maps raw source ids to labels and writes the question in operator words", () => {
    expect(optionLabel(dieselSource.options[0])).toBe("Generator diesel from production runs");
    expect(optionLabel(dieselSource.options[2])).toBe("Neither, entry");
    expect(decisionQuestion(electricityClash)).toBe("Which component gets electricity from production runs?");
    expect(decisionQuestion(dieselSource)).toBe("Which source fills Biomass processing fuel usage?");
  });

  it("writes each explanation for its source", () => {
    expect(decisionSituation(dieselSource)).toBe("noma keeps generator diesel from production runs and startup diesel from production runs separately. The name of Biomass processing fuel usage does not say which one it means.");
  });

  it("does not start on a blocked template", () => {
    const blocked = { ...template("a", "A", { defaults: [startupDefault] }), blockedReason: "x" };
    expect(startState({ fitting: [blocked], templateId: "a", step: null })).toEqual({ templateId: null, stepIndex: 0 });
  });

  it("never falls back to another template when an explicit one is not offered", () => {
    const only = template("a", "A", { defaults: [startupDefault] });
    expect(startState({ fitting: [only], templateId: "missing", step: "decisions" })).toEqual({ templateId: null, stepIndex: 0 });
  });

  it("tracks open decisions and the entries each answer creates", () => {
    const { plan } = template("t", "T", { decisions: [electricityClash, dieselSource], defaults: [startupDefault] });
    expect(openDecisions(plan, {})).toHaveLength(2);
    expect(openDecisions(plan, { "clash:run-electricity": "pyrolyzer", fuel: "entry" })).toHaveLength(0);
    // One electricity component and the fuel component take an entry.
    expect(entryCount(plan, { "clash:run-electricity": "pyrolyzer", fuel: "entry" }, {})).toBe(2);
    expect(entryCount(plan, { "clash:run-electricity": "pyrolyzer", fuel: "run-genset-diesel" }, { startup: "entry" })).toBe(2);
  });

  it("preselects the one template that can be picked and always opens on the template list", () => {
    const ready = template("a", "A", { defaults: [startupDefault] });
    const asking = template("b", "B", { decisions: [dieselSource] });
    expect(startState({ fitting: [ready], templateId: null, step: null })).toEqual({ templateId: "a", stepIndex: 0 });
    expect(startState({ fitting: [asking], templateId: null, step: null })).toEqual({ templateId: "b", stepIndex: 0 });
    expect(startState({ fitting: [ready, asking], templateId: null, step: null })).toEqual({ templateId: null, stepIndex: 0 });
    expect(startState({ fitting: [ready, asking], templateId: "b", step: "decisions" })).toEqual({ templateId: "b", stepIndex: 1 });
  });

  it("explains a linked template only when the list cannot show it", () => {
    const data = { fitting: [{ id: "a" }], notFitting: [{ id: "n" }] };
    expect(notOfferedReason(data, null)).toBeNull();
    expect(notOfferedReason(data, "a")).toBeNull();
    expect(notOfferedReason(data, "n")).toBeNull();
    expect(notOfferedReason(data, "gone")).toMatch(/not in this Isometric project/);
  });
});
