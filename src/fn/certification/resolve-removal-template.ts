import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import { removalTemplateBlocker, type RemovalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

/** Only freshly listed templates may compile. Stored observations never substitute for a deleted template. */
export function resolveRemovalTemplate(
  batches: readonly { removalTemplateId: string | null }[],
  facilityFacts: FacilityCertifierFacts,
) {
  const unresolved = (code: "unpinnedTemplate" | "mixedTemplatePins" | "templateNotFound") => ({
    removalTemplate: null as IsometricGhgEntryTemplate | null, lineSources: {} as LineSources,
    templateBlockers: [removalTemplateBlocker(code)],
    blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
  });
  const result = resolveBatchPin(batches);
  if ("code" in result) return unresolved(result.code);
  const facts = facilityFacts.templatesById[result.pin];
  if (!facts) return unresolved("templateNotFound");
  const templateBlockers: RemovalTemplateBlocker[] = [];
  if (!facts.observation || facts.enrichmentProblems.length) templateBlockers.push(removalTemplateBlocker("templateNotFullyRead"));
  if (facts.template.groups.some((group) => group.components.some((component) =>
    component.inputs.some((input) => input.type === "fixed" && !input.datapoint_id),
  ))) templateBlockers.push(removalTemplateBlocker("missingFixedDatapoint"));
  if (facts.lineSourceProblems.length) {
    templateBlockers.push(removalTemplateBlocker("templateLinesNeedReview"));
  }
  return {
    removalTemplate: facts.template, lineSources: facts.observation?.lineSources ?? {}, templateBlockers,
    blueprintsForTemplate: facts.blueprintsForTemplate, unresolvedBlueprintKeys: facts.unresolvedBlueprintKeys,
    unbindableTemplateInputs: facts.unbindableTemplateInputs, requiredTransportCategories: facts.requiredTransportCategories,
  };
}
