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
  if (!batches.length || batches.some((batch) => !batch.removalTemplateId)) return unresolved("unpinnedTemplate");
  const pins = [...new Set(batches.map((batch) => batch.removalTemplateId))];
  if (pins.length !== 1) return unresolved("mixedTemplatePins");
  const facts = facilityFacts.templatesById[pins[0]!];
  if (!facts) return unresolved("templateNotFound");
  const templateBlockers: RemovalTemplateBlocker[] = [];
  if (!facts.observation || facts.enrichmentProblems.length) templateBlockers.push(removalTemplateBlocker("templateNotFullyRead"));
  if (facts.lineSourceProblems.length) {
    templateBlockers.push(removalTemplateBlocker("templateLinesNeedReview"));
  }
  return {
    removalTemplate: facts.template, lineSources: facts.observation?.lineSources ?? {}, templateBlockers,
    blueprintsForTemplate: facts.blueprintsForTemplate, unresolvedBlueprintKeys: facts.unresolvedBlueprintKeys,
    unbindableTemplateInputs: facts.unbindableTemplateInputs, requiredTransportCategories: facts.requiredTransportCategories,
  };
}
