import { expect, it } from "vitest";
import { isTemplateReady, linesToDecideCount, type RemovalTemplateReadinessEntry } from "./removal-template-readiness";

const ready: RemovalTemplateReadinessEntry = {
  availability: "listed", template: { credit_type: "REMOVAL", groups: [] }, observation: {},
  enrichmentProblems: [], lineSourceProblems: [],
  lines: [{ component: { id: "line" }, contract: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } }],
};

it("requires a listed Removal template with a complete stored read", () => {
  expect(isTemplateReady(ready)).toBe(true);
  expect(isTemplateReady({ ...ready, availability: "missing" })).toBe(false);
  expect(isTemplateReady({ ...ready, template: null })).toBe(false);
  expect(isTemplateReady({ ...ready, template: { credit_type: "REDUCTION", groups: [] } })).toBe(false);
  expect(isTemplateReady({ ...ready, observation: null })).toBe(false);
  expect(isTemplateReady({ ...ready, enrichmentProblems: [{ code: "unknown-enrichment" }] })).toBe(false);
});

it.each([undefined, null, ""])("refuses a fixed input with datapoint_id %s even without enrichment problems", (datapointId) => {
  const template = {
    credit_type: "REMOVAL",
    groups: [{ components: [{ inputs: [{ type: "fixed", datapoint_id: datapointId }] }] }],
  };
  expect(isTemplateReady({ ...ready, template })).toBe(false);
  template.groups[0].components[0].inputs[0].datapoint_id = "dp_fixed";
  expect(isTemplateReady({ ...ready, template })).toBe(true);
});

it("counts each undecided line once, including invalid saved decisions", () => {
  const entry: RemovalTemplateReadinessEntry = {
    ...ready,
    lines: [
      ...ready.lines,
      { component: { id: "missing" }, contract: undefined },
      { component: { id: "proposal" }, contract: { scope: "operating", origin: "proposed", entryPolicy: "additive" } },
      { component: { id: "unassigned" }, contract: { scope: "unassigned", origin: "reviewed", entryPolicy: "none" } },
    ],
    lineSourceProblems: [{ componentId: "line", code: "ambiguous" }, { componentId: "line", code: "foreign-automatic-source" }],
  };
  expect(linesToDecideCount(entry)).toBe(4);
  expect(isTemplateReady(entry)).toBe(false);
  expect(linesToDecideCount(ready)).toBe(0);
});

it.each(["bootstrap", "carried", "reviewed"] as const)("accepts a settled %s decision", (origin) => {
  expect(isTemplateReady({ ...ready, lines: [{
    component: { id: "line" }, contract: { scope: "forbidden", origin, entryPolicy: "none" },
  }] })).toBe(true);
});
