import { expect, it } from "vitest";
import { removalTemplateVerdict, type RemovalTemplateVerdictEntry, type RemovalTemplateVerdict } from "./removal-template-verdict";
import { DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR, UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";

const ready: RemovalTemplateVerdictEntry = {
  availability: "listed", template: { credit_type: "REMOVAL", groups: [] }, observation: {},
  enrichmentProblems: [], lineSourceProblems: [],
  lines: [{ component: { id: "line" }, contract: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } }],
};

const readyVerdict: RemovalTemplateVerdict = {
  toDecideCount: 0, blockers: [], ready: true, blocker: null, setupBlocker: null,
};
const templateWithComponent = (blueprintKey: string, inputs: { type: string; datapoint_id?: string }[] = []) => ({
  credit_type: "REMOVAL", groups: [{ components: [{ blueprint_key: blueprintKey, inputs }] }],
});
const pending = [{ component: { id: "pending" }, contract: undefined }];
const unread = { observation: null, enrichmentProblems: ["unread input"] };
const cases: { shape: string; entry: Partial<RemovalTemplateVerdictEntry>; verdict: Partial<RemovalTemplateVerdict> }[] = [
  { shape: "missing", entry: { availability: "missing", template: null, observation: null, lines: [] },
    verdict: { ready: false, blockers: ["templateNotFound", "missingFixedDatapoint", "templateNotFullyRead"], blocker: "templateNotFound", setupBlocker: "templateNotFound" } },
  { shape: "unlisted despite a stored template", entry: { availability: "missing" },
    verdict: { ready: false, blockers: ["templateNotFound"], blocker: "templateNotFound", setupBlocker: "templateNotFound" } },
  { shape: "null template despite listed availability", entry: { template: null },
    verdict: { ready: false, blockers: ["templateNotFound", "missingFixedDatapoint"], blocker: "templateNotFound", setupBlocker: "templateNotFound" } },
  { shape: "not Removal, before storage or decisions", entry: { template: { ...templateWithComponent(DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR), credit_type: "REDUCTION" }, lines: pending, ...unread },
    verdict: { toDecideCount: 1, ready: false, blockers: ["notRemovalTemplate", "unsupportedSequestration", "templateLinesNeedReview", "templateNotFullyRead"], blocker: "notRemovalTemplate", setupBlocker: "notRemovalTemplate" } },
  { shape: "deprecated sequestration, before missing fixed values", entry: { template: templateWithComponent(DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR, [{ type: "fixed" }]), lines: pending, ...unread },
    verdict: { toDecideCount: 1, ready: false, blockers: ["unsupportedSequestration", "missingFixedDatapoint", "templateLinesNeedReview", "templateNotFullyRead"], blocker: "unsupportedSequestration", setupBlocker: "unsupportedSequestration" } },
  { shape: "unsampled Method B sequestration", entry: { template: templateWithComponent(UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR) },
    verdict: { ready: false, blockers: ["unsupportedSequestration"], blocker: "unsupportedSequestration", setupBlocker: "unsupportedSequestration" } },
  { shape: "fixed input without datapoint, before decisions or unread inputs", entry: { template: templateWithComponent("grid_electricity_use", [{ type: "fixed" }]), lines: pending, ...unread },
    verdict: { toDecideCount: 1, ready: false, blockers: ["missingFixedDatapoint", "templateLinesNeedReview", "templateNotFullyRead"], blocker: "missingFixedDatapoint", setupBlocker: "missingFixedDatapoint" } },
  { shape: "components to decide, before unread inputs", entry: { lines: pending, ...unread },
    verdict: { toDecideCount: 1, ready: false, blockers: ["templateLinesNeedReview", "templateNotFullyRead"], blocker: "templateLinesNeedReview", setupBlocker: "templateNotFullyRead" } },
  { shape: "components to decide in a complete read", entry: { lines: pending },
    verdict: { toDecideCount: 1, ready: false, blockers: ["templateLinesNeedReview"], blocker: "templateLinesNeedReview" } },
  { shape: "not fully read", entry: { enrichmentProblems: ["unread input"] },
    verdict: { ready: false, blockers: ["templateNotFullyRead"], blocker: "templateNotFullyRead", setupBlocker: "templateNotFullyRead" } },
  { shape: "read-only preview can enter setup", entry: { observation: null },
    verdict: { ready: false, blockers: ["templateNotFullyRead"], blocker: "templateNotFullyRead" } },
  { shape: "ready", entry: {}, verdict: {} },
];

it.each(cases)("returns the caller-facing verdict for $shape", ({ entry, verdict }) => {
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
      ...ready.lines, ...ready.lines,
      { component: { id: "missing" }, contract: undefined },
      { component: { id: "proposal" }, contract: { scope: "operating", origin: "proposed", entryPolicy: "additive" } },
      { component: { id: "unassigned" }, contract: { scope: "unassigned", origin: "reviewed", entryPolicy: "none" } },
    ],
    lineSourceProblems: [{ componentId: "line", code: "ambiguous" }, { componentId: "line", code: "foreign-automatic-source" }],
  };
  expect(removalTemplateVerdict(entry).toDecideCount).toBe(4);
  expect(removalTemplateVerdict(entry).ready).toBe(false);
  expect(removalTemplateVerdict(ready).toDecideCount).toBe(0);
});

it.each(["bootstrap", "carried", "reviewed"] as const)("accepts a settled %s decision", (origin) => {
  expect(removalTemplateVerdict({ ...ready, lines: [{
    component: { id: "line" }, contract: { scope: "forbidden", origin, entryPolicy: "none" },
  }] }).ready).toBe(true);
});
