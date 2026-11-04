import { expect, it } from "vitest";
import sandbox from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { setupPlan, type RemovalTemplateSetupPlan } from "./removal-template-setup-plan";
import { setupPlanFingerprint } from "./removal-template-setup-fingerprint";
import { protocolDefaultFixture } from "./removal-template-setup-test-fixtures";

function fixturePlan() {
  const definition = normalizeTemplateDefinition(protocolDefaultFixture());
  const sources = resolveLineSources({ definition });
  const plan = setupPlan(definition, sources, validateLineSources(definition, sources));
  const settled = normalizeTemplateDefinition(sandbox as GhgEntryTemplate);
  plan.decided = setupPlan(settled, resolveLineSources({ definition: settled }), []).decided;
  return plan;
}

it("is stable across ordering, labels and observation-only contract metadata", () => {
  const plan = fixturePlan();
  const reordered = structuredClone(plan);
  reordered.decided.reverse();
  reordered.defaults.reverse();
  reordered.decisions.reverse();
  for (const line of reordered.decided) {
    line.component.displayName += " renamed";
    line.contract = { ...line.contract!, origin: "carried", templateOrder: { groupPosition: 1, position: 1 } };
  }
  for (const line of reordered.defaults) line.options.reverse();
  for (const decision of reordered.decisions) {
    decision.components.reverse();
    decision.options.reverse();
    for (const option of decision.options) {
      option.label += " renamed";
      option.assignments = Object.fromEntries(Object.entries(option.assignments).reverse());
    }
  }
  expect(setupPlanFingerprint(reordered)).toBe(setupPlanFingerprint(plan));
});

it.each<[string, (plan: RemovalTemplateSetupPlan) => void]>([
  ["a decided contract", (plan) => { plan.decided[0].contract!.entryPolicy = "single"; }],
  ["a decided source", (plan) => { plan.decided[0].contract!.automaticSource = "run-electricity"; }],
  ["a component id", (plan) => { plan.decided[0].component.id += "-changed"; }],
  ["a bucket", (plan) => { plan.decided.push(plan.defaults.pop()!); }],
  ["a decision id", (plan) => { plan.decisions[0].id += "-changed"; }],
  ["a decision kind", (plan) => { plan.decisions[0].kind = "added"; }],
  ["a decision component", (plan) => { plan.decisions[0].components.pop(); }],
  ["an option id", (plan) => { plan.decisions[0].options[0].id += "-changed"; }],
  ["an option contract", (plan) => { Object.values(plan.decisions[0].options[0].assignments)[0].entryPolicy = "single"; }],
  ["a default proposal", (plan) => { plan.defaults[0].proposal = plan.defaults[0].options.find((option) => option.id !== plan.defaults[0].proposal.id)!; }],
])("changes with %s", (_, change) => {
  const plan = fixturePlan();
  const fingerprint = setupPlanFingerprint(plan);
  change(plan);
  expect(setupPlanFingerprint(plan)).not.toBe(fingerprint);
});
