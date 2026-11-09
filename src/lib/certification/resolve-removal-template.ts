import { removalTemplateReviewEntry } from "@/lib/certification/removal-template-review-entry";
import { removalTemplateVerdict } from "@/lib/certification/removal-template-verdict";
import { deriveRemovalEmissionLines } from "@/lib/certification/removal-emission-lines";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import type { RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { ownValue } from "@/lib/isometric/semantic-binding-catalog";
import type { BatchEmissionContext } from "./batch-emission-context";
import { type BatchEmissionLine } from "@/lib/certification/emission-lines";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations/normalize";
import { withTemplateOrder } from "@/lib/isometric/template-observations/template-order";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { lineNeedsReview, validateLineSources, type LineSources } from "@/lib/isometric/template-observations/line-sources";
import { removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

/** A datapoint fixed in the template, read with the observation's enrichment. */
export interface FixedInputValue { componentId: string; inputKey: string; magnitude: number; unit: string }

/** Only freshly listed templates may compile. Stored observations never substitute for a deleted template. */
export function resolveRemovalTemplate(
  batches: readonly { id?: string; removalTemplateId: string | null }[],
  facilityFacts: FacilityCertifierFacts,
  batchFacts: BatchEmissionContext = {},
  contributions?: RemovalEntryContributions,
) {
  const unresolved = (code: "unpinnedTemplate" | "mixedTemplatePins" | "templateNotFound") => ({
    undecidedLineIds: [] as string[],
    emissionLinesByBatchId: {} as Record<string, BatchEmissionLine[]>,
    emissionLines: null as BatchEmissionLine[] | null,
    removalTemplate: null as IsometricGhgEntryTemplate | null, lineSources: {} as LineSources,
    templateBlockers: [removalTemplateBlocker(code)],
    blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
    fixedInputValues: [] as FixedInputValue[],
  });
  const result = resolveBatchPin(batches);
  if ("code" in result) return unresolved(result.code);
  const facts = facilityFacts.templatesById[result.pin];
  if (!facts) return unresolved("templateNotFound");
  const definition = normalizeTemplateDefinition(facts.template);
  const verdict = removalTemplateVerdict(removalTemplateReviewEntry({
    templateId: facts.template.id, ...facts, definition,
  }), "pinned");
  const templateBlockers = verdict.blockers.map(removalTemplateBlocker);
  const sources = facts.observation?.lineSources;
  const problems = sources ? [...facts.lineSourceProblems, ...validateLineSources(definition, sources)] : [];
  // Only current template components count, never removed components kept for stale entries.
  const undecidedLineIds = sources ? [...new Set(definition.groups.flatMap((group) => group.components
    .filter((component) => lineNeedsReview(component.id, ownValue(sources, component.id), problems))
    .map((component) => component.id)))] : [];
  const batchIds = batches.flatMap((batch) => batch.id ? [batch.id] : []);
  const { emissionLinesByBatchId: resolvedLines } = deriveRemovalEmissionLines(!facts.observation ? {} : Object.fromEntries(
    (batchIds.length ? batchIds : [""]).map((id) => [id, {
      definition,
      lineSources: withTemplateOrder(facts.template, facts.observation!.lineSources),
      problems: facts.lineSourceProblems, enrichmentComplete: facts.enrichmentProblems.length === 0,
      automaticFigures: batchFacts[id]?.automaticFigures ?? {},
      omittedAutomaticSources: batchFacts[id]?.omittedAutomaticSources,
      entries: batchFacts[id]?.entries ?? [],
      previousObservations: batchFacts[id]?.previousObservations,
      entriesWithoutRemoval: batchFacts[id]?.entriesWithoutRemoval,
    }]),
  ), contributions);
  const emissionLinesByBatchId = batchIds.length ? resolvedLines : {};
  const emissionLines = !facts.observation ? null : Object.values(resolvedLines).flat();
  return {
    emissionLines, emissionLinesByBatchId, undecidedLineIds,
    removalTemplate: facts.template, lineSources: facts.observation?.lineSources ?? {}, templateBlockers,
    blueprintsForTemplate: facts.blueprintsForTemplate, unresolvedBlueprintKeys: facts.unresolvedBlueprintKeys,
    fixedInputValues: fixedInputValues(definition, facts.observation?.enrichment),
    unbindableTemplateInputs: contributions ? findUnbindableTemplateInputs(facts.template, { lineSources: facts.observation?.lineSources, entriesCanSubmit: true, enrichmentComplete: facts.enrichmentProblems.length === 0 }) : facts.unbindableTemplateInputs, requiredTransportCategories: facts.requiredTransportCategories,
  };
}

function fixedInputValues(definition: ReturnType<typeof normalizeTemplateDefinition>, enrichment: Record<string, Record<string, unknown>> | undefined): FixedInputValue[] {
  return definition.groups.flatMap((group) => group.components.flatMap((component) => component.inputs.flatMap((input) => {
    const enriched = input.type === "fixed" ? enrichment?.[component.id]?.[input.key] as { unit?: string; fixedValue?: string | number | null } | undefined : undefined;
    const magnitude = enriched?.fixedValue == null ? NaN : Number(enriched.fixedValue);
    return enriched?.unit && Number.isFinite(magnitude) ? [{ componentId: component.id, inputKey: input.key, magnitude, unit: enriched.unit }] : [];
  })));
}
