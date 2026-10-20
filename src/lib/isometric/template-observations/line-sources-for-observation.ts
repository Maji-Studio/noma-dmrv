import { fullFingerprint, semanticFingerprint } from "./fingerprints";
import { resolveLineSources, withoutUnacceptableProposals, type LineSources } from "./line-sources";
import type { TemplateDefinition, TemplateEnrichment } from "./types";

/** Compute the contracts an observation would use, without storing a read. */
export function lineSourcesForObservation({ definition, enrichment, latest }: {
  definition: TemplateDefinition;
  enrichment: TemplateEnrichment;
  latest?: {
    definition: TemplateDefinition;
    lineSources: LineSources;
    semanticFingerprint: string;
    fullFingerprint: string;
  } | null;
}): LineSources {
  return latest && semanticFingerprint(definition, enrichment) === latest.semanticFingerprint &&
    fullFingerprint(definition, enrichment) === latest.fullFingerprint
    ? withoutUnacceptableProposals(definition, latest.lineSources)
    : resolveLineSources({ definition, previous: latest ?? undefined });
}
