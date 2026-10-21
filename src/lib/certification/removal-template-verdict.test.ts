import { expect, it } from "vitest";
import { removalTemplateVerdict, type RemovalTemplateVerdictEntry, type RemovalTemplateVerdict } from "./removal-template-verdict";
import { DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR, UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";

const ready: RemovalTemplateVerdictEntry = {
  availability: "listed", template: { credit_type: "REMOVAL", groups: [] }, observation: {},
  enrichmentProblems: [], lineSourceProblems: [],
  lines: [{ component: { id: "line" }, contract: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } }],
};

const readyVerdict: RemovalTemplateVerdict = {
  listed: true, removalType: true, fullyRead: true, fixedValuesSet: true,
  sequestrationSelectable: true, sequestrationError: null,
  toDecideIds: [], toDecideCount: 0, ready: true, blocker: null, setupBlocker: null,
};
const templateWithComponent = (blueprintKey: string, inputs: { type: string; datapoint_id?: string }[] = []) => ({
  credit_type: "REMOVAL", groups: [{ components: [{ blueprint_key: blueprintKey, inputs }] }],
});
const pending = [{ component: { id: "pending" }, contract: undefined }];
const unread = { observation: null, enrichmentProblems: ["unread input"] };
const cases: { shape: string; entry: Partial<RemovalTemplateVerdictEntry>; verdict: Partial<RemovalTemplateVerdict> }[] = [
  { shape: "missing", entry: { availability: "missing", template: null, observation: null, lines: [] },
    verdict: { listed: false, removalType: false, fullyRead: false, fixedValuesSet: false, sequestrationSelectable: false,
      ready: false, blocker: "templateNotFound", setupBlocker: "templateNotFound" } },
  { shape: "unlisted despite a stored template", entry: { availability: "missing" },
    verdict: { listed: false, ready: false, blocker: "templateNotFound", setupBlocker: "templateNotFound" } },
  { shape: "null template despite listed availability", entry: { template: null },
    verdict: { listed: false, removalType: false, fixedValuesSet: false, sequestrationSelectable: false,
      ready: false, blocker: "templateNotFound", setupBlocker: "templateNotFound" } },
  { shape: "not Removal, before storage or decisions", entry: { template: { ...templateWithComponent(DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR), credit_type: "REDUCTION" }, lines: pending, ...unread },
    verdict: { removalType: false, fullyRead: false, sequestrationSelectable: false,
      sequestrationError: "The selected template uses the legacy 1,000-year component with total-carbon and uncapped durability semantics. Select a template using biochar_sequestration_1000_year_f_durable_max.",
      toDecideIds: ["pending"], toDecideCount: 1, ready: false, blocker: "notRemovalTemplate", setupBlocker: "notRemovalTemplate" } },
  { shape: "deprecated sequestration, before missing fixed values", entry: { template: templateWithComponent(DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR, [{ type: "fixed" }]), lines: pending, ...unread },
    verdict: { fullyRead: false, fixedValuesSet: false, sequestrationSelectable: false,
      sequestrationError: "The selected template uses the legacy 1,000-year component with total-carbon and uncapped durability semantics. Select a template using biochar_sequestration_1000_year_f_durable_max.",
      toDecideIds: ["pending"], toDecideCount: 1, ready: false, blocker: "unsupportedSequestration", setupBlocker: "unsupportedSequestration" } },
  { shape: "unsampled Method B sequestration", entry: { template: templateWithComponent(UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR) },
    verdict: { sequestrationSelectable: false,
      sequestrationError: "The selected template uses the unsampled 1,000-year component. Unsampled Method B is not supported; select the sampled 1,000-year template.",
      ready: false, blocker: "unsupportedSequestration", setupBlocker: "unsupportedSequestration" } },
  { shape: "fixed input without datapoint, before decisions or unread inputs", entry: { template: templateWithComponent("grid_electricity_use", [{ type: "fixed" }]), lines: pending, ...unread },
    verdict: { fixedValuesSet: false, fullyRead: false, toDecideIds: ["pending"], toDecideCount: 1,
      ready: false, blocker: "missingFixedDatapoint", setupBlocker: "missingFixedDatapoint" } },
  { shape: "components to decide, before unread inputs", entry: { lines: pending, ...unread },
    verdict: { fullyRead: false, toDecideIds: ["pending"], toDecideCount: 1,
      ready: false, blocker: "templateLinesNeedReview", setupBlocker: "templateNotFullyRead" } },
  { shape: "components to decide in a complete read", entry: { lines: pending },
    verdict: { toDecideIds: ["pending"], toDecideCount: 1, ready: false, blocker: "templateLinesNeedReview" } },
  { shape: "not fully read", entry: { enrichmentProblems: ["unread input"] },
    verdict: { fullyRead: false, ready: false, blocker: "templateNotFullyRead", setupBlocker: "templateNotFullyRead" } },
  { shape: "read-only preview can enter setup", entry: { observation: null },
    verdict: { fullyRead: false, ready: false, blocker: "templateNotFullyRead" } },
  { shape: "ready", entry: {}, verdict: {} },
];

it.each(cases)("returns the whole verdict for $shape", ({ entry, verdict }) => {
  expect(removalTemplateVerdict({ ...ready, ...entry })).toEqual({ ...readyVerdict, ...verdict });
});

it.each([undefined, null, ""])("refuses a fixed input with datapoint_id %s even without enrichment problems", (datapointId) => {
  const template = {
    credit_type: "REMOVAL",
    groups: [{ components: [{ blueprint_key: "grid_electricity_use", inputs: [{ type: "fixed", datapoint_id: datapointId }] }] }],
  };
  expect(removalTemplateVerdict({ ...ready, template }).ready).toBe(false);
  template.groups[0].components[0].inputs[0].datapoint_id = "dp_fixed";
  expect(removalTemplateVerdict({ ...ready, template }).ready).toBe(true);
});

it("counts each undecided line once, including invalid saved decisions", () => {
  const entry: RemovalTemplateVerdictEntry = {
    ...ready,
    lines: [
      ...ready.lines,
      { component: { id: "missing" }, contract: undefined },
      { component: { id: "proposal" }, contract: { scope: "operating", origin: "proposed", entryPolicy: "additive" } },
      { component: { id: "unassigned" }, contract: { scope: "unassigned", origin: "reviewed", entryPolicy: "none" } },
    ],
    lineSourceProblems: [{ componentId: "line", code: "ambiguous" }, { componentId: "line", code: "foreign-automatic-source" }],
  };
  expect(removalTemplateVerdict(entry).toDecideCount).toBe(4);
  expect(removalTemplateVerdict(entry).toDecideIds).toEqual(["line", "missing", "proposal", "unassigned"]);
  expect(removalTemplateVerdict(entry).ready).toBe(false);
  expect(removalTemplateVerdict(ready).toDecideCount).toBe(0);
});

it.each(["bootstrap", "carried", "reviewed"] as const)("accepts a settled %s decision", (origin) => {
  expect(removalTemplateVerdict({ ...ready, lines: [{
    component: { id: "line" }, contract: { scope: "forbidden", origin, entryPolicy: "none" },
  }] }).ready).toBe(true);
});
