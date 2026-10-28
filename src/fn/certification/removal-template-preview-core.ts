import type { IsometricClient, IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import { normalizeTemplateDefinition, lineSourcesForObservation, enrichmentProblems, validateLineSources, type ComponentChange } from "@/lib/isometric/template-observations";
import { enrichmentForObservation } from "./observe-removal-template";
import { reviewLineSources } from "@/lib/certification/removal-template-review-sources";
import { removalTemplateReviewLines as reviewLines } from "@/lib/certification/removal-template-review-lines";

export async function readOnlyEntry(
  client: IsometricClient, template: IsometricGhgEntryTemplate, blueprints: IsometricComponentBlueprint[],
  latest: RemovalTemplateObservation | null, externalProjectId: string,
) {
  const definition = normalizeTemplateDefinition(template);
  const { enrichment } = await enrichmentForObservation({
    client, template, definition, previous: latest, externalProjectId,
    loadBlueprints: async () => blueprints,
  });
  const lineSources = lineSourcesForObservation({ definition, enrichment, latest });
  return {
    templateId: template.id, template, observation: null, preview: true,
    availability: "listed" as const, enrichment,
    changes: {} as Record<string, ComponentChange>,
    lines: reviewLines(definition, reviewLineSources(lineSources), {}, blueprints, template),
    enrichmentProblems: enrichmentProblems(definition, enrichment),
    lineSourceProblems: validateLineSources(definition, lineSources),
  };
}

