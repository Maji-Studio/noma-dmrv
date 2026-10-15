import { describe, expect, it } from "vitest";
import templateFixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import { resolveRemovalTemplate } from "./resolve-removal-template";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { findUnbindableTemplateInputs, formatUnbindableTemplateInputsText } from "@/lib/isometric/template-binding-coverage";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness } from "@/lib/certification/readiness";
import { deriveBatchHealth } from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";

const template = templateFixture as GhgEntryTemplate;

function facts(): FacilityCertifierFacts {
  return {
    // Deliberately a different default. It must never be used for a Removal.
    defaultTemplate: { ...template, id: "other-default" },
    templatesById: {
      [template.id]: {
        template, observation: { lineSources: {} }, enrichmentProblems: [], lineSourceProblems: [],
        blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
      },
    },
  } as unknown as FacilityCertifierFacts;
}

describe("Removal template pins", () => {
  it("blocks an unpinned member without substituting the default", () => {
    const result = resolveRemovalTemplate([{ removalTemplateId: template.id }, { removalTemplateId: null }], facts());
    expect(result.removalTemplate).toBeNull();
    expect(result.templateBlockers).toEqual([{ code: "unpinnedTemplate", message: "Choose a Removal template for this credit batch." }]);
  });
  it("refuses mixed pins", () => {
    expect(resolveRemovalTemplate([{ removalTemplateId: template.id }, { removalTemplateId: "other-default" }], facts()).templateBlockers)
      .toEqual([{ code: "mixedTemplatePins", message: "These credit batches use different Removal templates." }]);
  });
  it("refuses a pin no longer listed even when a default exists", () => {
    const result = resolveRemovalTemplate([{ removalTemplateId: "deleted" }], facts());
    expect(result.removalTemplate).toBeNull();
    expect(result.templateBlockers).toEqual([{ code: "templateNotFound", message: "Template no longer exists in Isometric." }]);
  });
  it("uses the shared member pin", () => {
    const result = resolveRemovalTemplate([{ removalTemplateId: template.id }, { removalTemplateId: template.id }], facts());
    expect(result.removalTemplate?.id).toBe(template.id);
    expect(result.templateBlockers).toEqual([]);
  });
  it("blocks unread observations and proposals independently", () => {
    const input = facts();
    input.templatesById[template.id]!.observation = null;
    input.templatesById[template.id]!.lineSourceProblems = [{ code: "unassigned", componentId: "line" }];
    expect(resolveRemovalTemplate([{ removalTemplateId: template.id }], input).templateBlockers.map((blocker) => blocker.code))
      .toEqual(["templateNotFullyRead", "templateLinesNeedReview"]);
  });
});

// Exercise diagnostics, template resolution, readiness and repair routing together.
it.each(["incompatible-carried", "duplicate-source"] as const)("routes %s contracts to line review", (problem) => {
  const original = normalizeTemplateDefinition(template);
  const previous = { definition: original, lineSources: resolveLineSources({ definition: original }) };
  const changed = structuredClone(template);
  const gensetId = "rtc_1KWHFRM4GSBX5Y7A";
  const startupId = "rtc_1KWP4Y13JSBXV8FB";
  if (problem === "incompatible-carried") {
    changed.groups.flatMap((group) => group.components).find((component) => component.id === gensetId)!.inputs.push({
      input_key: "unknown", type: "monitored", quantity_kind: "pressure", datapoint_id: null, display_name: "New input",
    });
  }
  const definition = normalizeTemplateDefinition(changed);
  const lineSources = resolveLineSources({ definition, previous });
  if (problem === "duplicate-source") lineSources[startupId].automaticSource = "run-genset-diesel";
  const input = facts();
  const templateFacts = input.templatesById[template.id]!;
  templateFacts.template = changed;
  templateFacts.observation = { ...templateFacts.observation!, definition, lineSources };
  templateFacts.lineSourceProblems = validateLineSources(definition, lineSources);
  templateFacts.unbindableTemplateInputs = findUnbindableTemplateInputs(changed, { lineSources });
  const diagnostics = templateFacts.unbindableTemplateInputs.filter((finding) => [gensetId, startupId].includes(finding.componentId));
  expect(diagnostics).toContainEqual(expect.objectContaining({ componentId: gensetId,
    reason: problem === "duplicate-source" ? "ambiguous" : "unassigned" }));
  expect(formatUnbindableTemplateInputsText(diagnostics)).toContain("Review the Removal template lines in Certification settings.");
  expect(formatUnbindableTemplateInputsText(diagnostics)).not.toContain("ask support");
  const resolved = resolveRemovalTemplate([{ removalTemplateId: template.id }], input);
  const readiness = {
    local: null, lockInFlight: false, hasMapping: true, hasOrgCredentials: true, hasRemovalTemplate: true,
    hasSubmittableRuns: true, requiredTransport: [], feedstockTypeMappingGaps: [], ...resolved,
  };
  expect(deriveRemovalReadiness(readiness).state).toBe("blocked");
  const check = buildRemovalRequirementsChecklist(readiness).find((check) => check.key === "template")!;
  expect(check.templateBlockerCodes).toEqual(["templateLinesNeedReview"]);
  const health = deriveBatchHealth(toBatchHealthFacts({
    ...resolved, mapping: {}, memberBatches: [{ id: "batch-1", code: "CB-1" }],
    hasSubmittableRuns: true, submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
    entityReadinessGaps: [], requiredTransportCategories: [],
  } as unknown as import("./certify-context").RemovalCertifyContext, "batch-1"));
  const batchCheck = health.checks.find((check) => check.key === "template" && check.fixTarget === "templateLineReview")!;
  expect(batchCheck.status).toBe("unmet");
  expect(batchHealthFixLinkFor(batchCheck, "facility-1", "batch-1")).toEqual({
    label: "Review template lines", href: certificationRemovalTemplatesHref("facility-1"),
  });
});
