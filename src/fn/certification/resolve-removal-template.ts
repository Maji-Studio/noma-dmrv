import type { BatchEmissionContext } from "./batch-emission-context";
import { deriveBatchEmissionLines, type BatchEmissionLine } from "@/lib/certification/emission-lines";
import { withRemovedEntryComponents } from "@/lib/certification/emission-line-definition";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations/normalize";
import { withTemplateOrder } from "@/lib/isometric/template-observations/template-order";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import { removalTemplateBlocker, type RemovalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

/** Only freshly listed templates may compile. Stored observations never substitute for a deleted template. */
export function resolveRemovalTemplate(
  batches: readonly { id?: string; removalTemplateId: string | null }[],
  facilityFacts: FacilityCertifierFacts,
  batchFacts: BatchEmissionContext = {},
) {
  const unresolved = (code: "unpinnedTemplate" | "mixedTemplatePins" | "templateNotFound") => ({
    emissionLinesByBatchId: {} as Record<string, BatchEmissionLine[]>,
    emissionLines: null as BatchEmissionLine[] | null,
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
  const derive = (batchId?: string) => deriveBatchEmissionLines({
    definition: withRemovedEntryComponents(normalizeTemplateDefinition(facts.template),
      batchId ? batchFacts[batchId]?.entries ?? [] : [],
      batchId ? batchFacts[batchId]?.previousObservations ?? new Map() : new Map()),
    lineSources: withTemplateOrder(facts.template, facts.observation!.lineSources),
    problems: facts.lineSourceProblems, enrichmentComplete: facts.enrichmentProblems.length === 0,
    automaticFigures: batchId ? batchFacts[batchId]?.automaticFigures ?? {} : {},
    entries: batchId ? batchFacts[batchId]?.entries ?? [] : [],
  });
  const emissionLinesByBatchId: Record<string, BatchEmissionLine[]> = {};
  if (facts.observation) for (const batch of batches) {
    if (batch.id) emissionLinesByBatchId[batch.id] = derive(batch.id);
  }
  const emissionLines = !facts.observation ? null : Object.keys(emissionLinesByBatchId).length
    ? Object.values(emissionLinesByBatchId).flat() : derive();
  return {
    emissionLines, emissionLinesByBatchId,
    removalTemplate: facts.template, lineSources: facts.observation?.lineSources ?? {}, templateBlockers,
    blueprintsForTemplate: facts.blueprintsForTemplate, unresolvedBlueprintKeys: facts.unresolvedBlueprintKeys,
    unbindableTemplateInputs: facts.unbindableTemplateInputs, requiredTransportCategories: facts.requiredTransportCategories,
  };
}
