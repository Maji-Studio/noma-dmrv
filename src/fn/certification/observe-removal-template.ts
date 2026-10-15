import type { OrgContext } from "@/lib/auth/server";
import type { IsometricClient, IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { canonicalJson } from "@/lib/canonical-json";
import { getLatestTemplateObservation, observeTemplate } from "@/data-access/removal-template-observations";
import { isEnrichmentComplete, normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { ISOMETRIC_PROVIDER } from "./shared";

export const TEMPLATE_ENRICHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export async function observeRemovalTemplate(ctx: OrgContext, input: {
  client: IsometricClient;
  externalProjectId: string;
  template: IsometricGhgEntryTemplate;
  blueprints: IsometricComponentBlueprint[];
  /** Submission and claim checks must re-read registry units and fixed factors. */
  refreshEnrichment?: boolean;
}) {
  const previous = await getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, input.template.id);
  const definition = normalizeTemplateDefinition(input.template);
  const age = previous ? Date.now() - previous.enrichedAt.getTime() : Infinity;
  const reuse = !input.refreshEnrichment && previous && previous.externalProjectId === input.externalProjectId && age >= 0 && age < TEMPLATE_ENRICHMENT_TTL_MS &&
    canonicalJson(previous.definition) === canonicalJson(definition) && isEnrichmentComplete(definition, previous.enrichment);
  const enrichment = reuse ? previous.enrichment : await loadTemplateEnrichment(input.client, input.template, input.blueprints);
  return observeTemplate(ctx, {
    provider: ISOMETRIC_PROVIDER, externalProjectId: input.externalProjectId, template: input.template, enrichment, enrichmentReused: !!reuse,
  });
}
