import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { normalizeTemplateDefinition, enrichmentProblems, validateLineSources, type ComponentChange, type EnrichmentProblem, type LineSourceProblem, type TemplateDefinition } from "@/lib/isometric/template-observations";
import { reviewLineSources } from "@/lib/certification/removal-template-review-sources";
import { removalTemplateReviewLines } from "@/lib/certification/removal-template-review-lines";

/** One structural entry for listings, stored reads and refreshed switch reads. */
export function removalTemplateReviewEntry(input: {
  templateId: string;
  template: IsometricGhgEntryTemplate | null;
  observation: RemovalTemplateObservation | null;
  definition?: TemplateDefinition;
  enrichmentProblems?: EnrichmentProblem[];
  lineSourceProblems?: LineSourceProblem[];
  blueprintsForTemplate?: IsometricComponentBlueprint[];
}, changes: Record<string, ComponentChange> = {}) {
  const observation = input.observation ? { ...input.observation, lineSources: reviewLineSources(input.observation.lineSources) } : null;
  const definition = input.definition ?? observation?.definition ?? (input.template ? normalizeTemplateDefinition(input.template) : null);
  return {
    templateId: input.templateId, template: input.template, observation,
    availability: input.template ? "listed" as const : "missing" as const, preview: false as boolean,
    enrichment: observation?.enrichment ?? null, changes,
    lines: definition ? removalTemplateReviewLines(definition, observation?.lineSources ?? {}, changes, input.blueprintsForTemplate ?? [], input.template ?? undefined) : [],
    enrichmentProblems: input.enrichmentProblems ?? (observation ? enrichmentProblems(observation.definition, observation.enrichment) : []),
    lineSourceProblems: input.lineSourceProblems ?? (input.observation ? validateLineSources(input.observation.definition, input.observation.lineSources) : []),
  };
}
