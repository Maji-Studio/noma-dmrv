import { env } from "@/config/env";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { OrgContext } from "@/lib/auth/server";
import type { IsometricClient, IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { allowsPeriodInputStub } from "@/lib/isometric/datapoint-mapping";
import { findUnbindableTemplateInputs, type UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";
import { enrichmentProblems, normalizeTemplateDefinition, validateLineSources, type EnrichmentProblem, type LineSourceProblem } from "@/lib/isometric/template-observations";
import { hasExplicitSequestrationBinding } from "@/lib/isometric/transformers/sequestration-binding";
import { logger } from "@/lib/log";
import { deriveRequiredTransportCategories, type TransportCategory } from "./certify-transport-coverage";
import { observeRemovalTemplate } from "./observe-removal-template";

export interface RemovalTemplateFacts {
  template: IsometricGhgEntryTemplate;
  observation: RemovalTemplateObservation | null;
  enrichmentProblems: EnrichmentProblem[];
  lineSourceProblems: LineSourceProblem[];
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  unbindableTemplateInputs: UnbindableTemplateInput[];
  requiredTransportCategories: TransportCategory[];
}

export async function loadRemovalTemplateFacts(ctx: OrgContext, input: {
  client: IsometricClient; externalProjectId: string; template: IsometricGhgEntryTemplate; blueprints: IsometricComponentBlueprint[];
}): Promise<RemovalTemplateFacts> {
  let observation: RemovalTemplateObservation | null = null;
  try { observation = await observeRemovalTemplate(ctx, input); }
  catch {
    logger.warn({ organizationId: ctx.organizationId, externalProjectId: input.externalProjectId, externalTemplateId: input.template.id }, "Removal template observation failed");
  }
  const definition = normalizeTemplateDefinition(input.template);
  const lineSources = observation?.lineSources ?? {};
  const referencedKeys = [...new Set(definition.groups.flatMap((group) => group.components.map((component) => component.blueprintKey)))];
  const blueprintByKey = new Map(input.blueprints.map((blueprint) => [blueprint.key, blueprint]));
  return {
    template: input.template, observation,
    enrichmentProblems: enrichmentProblems(definition, observation?.enrichment ?? {}),
    lineSourceProblems: validateLineSources(definition, lineSources),
    blueprintsForTemplate: referencedKeys.flatMap((key) => blueprintByKey.get(key) ?? []),
    unresolvedBlueprintKeys: referencedKeys.filter((key) => !blueprintByKey.has(key) && !hasExplicitSequestrationBinding(key)),
    unbindableTemplateInputs: findUnbindableTemplateInputs(input.template, { lineSources, allowPeriodInputStub: allowsPeriodInputStub(env.ISOMETRIC_ENVIRONMENT) }),
    requiredTransportCategories: deriveRequiredTransportCategories(input.template),
  };
}
