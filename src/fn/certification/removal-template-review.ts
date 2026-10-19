"use server";

import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";

import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { switchCreditBatchRemovalTemplate as switchTemplate } from "@/data-access/credit-batch-removal-template";
import { getLatestTemplateObservation, getPreviousTemplateObservation, reviewLineContracts } from "@/data-access/removal-template-observations";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates } from "@/lib/isometric";
import { allowedEntryPolicies, lineNeedsReview, catalogCandidates, compareTemplateObservations, enrichmentProblems, normalizeTemplateDefinition, resolveLineSources, validateLineSources, type ComponentChange, type LineSources, type TemplateDefinition } from "@/lib/isometric/template-observations";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { canonicalJson } from "@/lib/canonical-json";
import {
  loadRemovalTemplateReviewSchema, removalTemplateReviewPreviewSchema, reviewRemovalTemplateLinesSchema, switchCreditBatchRemovalTemplateSchema,
  type RemovalTemplateReviewPreviewInput, type ReviewRemovalTemplateLinesInput, type SwitchCreditBatchRemovalTemplateInput,
} from "@/schemas/removal-template-review";
import { withAction } from "../with-action";
import { loadFacilityCertifierFacts } from "./facility-certifier-facts";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { ISOMETRIC_PROVIDER } from "./shared";

function reviewLines(definition: TemplateDefinition, lineSources: LineSources, changes: Record<string, ComponentChange>) {
  return definition.groups.flatMap((group) => group.components.map((component) => ({
    component, groupKey: group.key, groupName: group.displayName,
    contract: lineSources[component.id] ?? { scope: "unassigned" as const, entryPolicy: "none" as const, origin: "proposed" as const },
    catalogCandidates: catalogCandidates(component, group.key), allowedEntryPolicies: allowedEntryPolicies(component),
    change: changes[component.id] ?? ("added" as ComponentChange),
  })));
}

export async function loadRemovalTemplateReview(facilityId: string) {
  return withAction(async (ctx) => {
    const id = loadRemovalTemplateReviewSchema.parse(facilityId);
    await requireOrgFacility(ctx, id);
    const facts = await loadFacilityCertifierFacts(ctx, id);
    return Promise.all(facts.removalTemplateIds.map(async (templateId) => {
      const current = facts.templatesById[templateId];
      const observation = current?.observation ?? null;
      const previous = observation ? await getPreviousTemplateObservation(ctx, ISOMETRIC_PROVIDER, templateId, observation.id) : null;
      const changes = observation && previous ? compareTemplateObservations(previous, observation) : {};
      const definition = observation?.definition ?? (current ? normalizeTemplateDefinition(current.template) : null);
      return {
        templateId, template: current?.template ?? null, observation,
        isDefault: templateId === facts.mapping?.defaultRemovalTemplateId,
        availability: current ? "listed" as const : "missing" as const,
        preview: false as boolean,
        enrichment: observation?.enrichment ?? null,
        changes,
        lines: definition ? reviewLines(definition, observation?.lineSources ?? {}, changes) : [],
        enrichmentProblems: current?.enrichmentProblems ?? [], lineSourceProblems: current?.lineSourceProblems ?? [],
      };
    }));
  });
}

export async function reviewRemovalTemplateLines(input: ReviewRemovalTemplateLinesInput) {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    return reviewLineContracts(ctx, reviewRemovalTemplateLinesSchema.parse(input));
  });
}

export async function switchCreditBatchRemovalTemplate(input: SwitchCreditBatchRemovalTemplateInput) {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    const parsed = switchCreditBatchRemovalTemplateSchema.parse(input);
    const batch = await getCreditBatchById(ctx, parsed.creditBatchId);
    if (!batch) throw new SafeError("Credit batch not found.");
    const mapping = await getCertifierProjectByFacility(ctx, batch.facilityId, ISOMETRIC_PROVIDER);
    if (!mapping) throw new SafeError("Link a facility to an Isometric project first.");
    const client = await resolveIsometricClient(ctx);
    const templates = await listGhgEntryTemplates(client, mapping.externalProjectId);
    const template = templates.find((candidate) => candidate.id === parsed.removalTemplateId);
    if (!template) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFound);
    if (template.credit_type !== "REMOVAL") throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.notRemovalTemplate);
    await loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: mapping.externalProjectId, blueprints: await listComponentBlueprints(client) });
    return switchTemplate(ctx, parsed);
  });
}

/** Any org member can preview a listed target, including one no batch has pinned yet. */
export async function loadRemovalTemplateReviewPreview(input: RemovalTemplateReviewPreviewInput) {
  return withAction(async (ctx) => {
    const { facilityId, removalTemplateId } = removalTemplateReviewPreviewSchema.parse(input);
    await requireOrgFacility(ctx, facilityId);
    const mapping = await getCertifierProjectByFacility(ctx, facilityId, ISOMETRIC_PROVIDER);
    if (!mapping) throw new SafeError("Link a facility to an Isometric project first.");
    const client = await resolveIsometricClient(ctx);
    const templates = await listGhgEntryTemplates(client, mapping.externalProjectId);
    const template = templates.find((candidate) => candidate.id === removalTemplateId);
    if (!template) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFound);
    if (template.credit_type !== "REMOVAL") throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.notRemovalTemplate);
    const facts = await loadRemovalTemplateFacts(ctx, {
      client, template, externalProjectId: mapping.externalProjectId, blueprints: await listComponentBlueprints(client),
    });
    const definition = normalizeTemplateDefinition(template);
    return {
      templateId: template.id,
      needsReviewCount: definition.groups.flatMap((group) => group.components).filter((component) =>
        lineNeedsReview(component.id, facts.observation?.lineSources[component.id], facts.lineSourceProblems),
      ).length,
      enrichmentProblems: facts.enrichmentProblems,
      lineSourceProblems: facts.lineSourceProblems,
    };
  });
}

/**
 * One listed Removal template, read for review without observing it. The
 * switch dialog's warning deep-links here for a template no credit batch pins
 * yet, so nothing is stored: lines come from the latest stored observation
 * when the template still matches it, else from the proposals an observation
 * would make, and units and factors are read live. The entry is read-only
 * (`observation: null`), because a draft needs an observation to save against.
 */
export async function loadRemovalTemplateReviewEntry(input: RemovalTemplateReviewPreviewInput) {
  return withAction(async (ctx) => {
    const { facilityId, removalTemplateId } = removalTemplateReviewPreviewSchema.parse(input);
    await requireOrgFacility(ctx, facilityId);
    const mapping = await getCertifierProjectByFacility(ctx, facilityId, ISOMETRIC_PROVIDER);
    if (!mapping) throw new SafeError("Link a facility to an Isometric project first.");
    const client = await resolveIsometricClient(ctx);
    const templates = await listGhgEntryTemplates(client, mapping.externalProjectId);
    const template = templates.find((candidate) => candidate.id === removalTemplateId);
    if (!template) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFound);
    if (template.credit_type !== "REMOVAL") throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.notRemovalTemplate);
    const definition = normalizeTemplateDefinition(template);
    const [latest, enrichment] = await Promise.all([
      getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, template.id),
      loadTemplateEnrichment(client, template, await listComponentBlueprints(client)),
    ]);
    const lineSources = latest && canonicalJson(latest.definition) === canonicalJson(definition)
      ? latest.lineSources
      : resolveLineSources({ definition, previous: latest ?? undefined });
    return {
      templateId: template.id, template, observation: null, preview: true,
      isDefault: template.id === mapping.defaultRemovalTemplateId,
      availability: "listed" as const,
      enrichment,
      changes: {} as Record<string, ComponentChange>,
      lines: reviewLines(definition, lineSources, {}),
      enrichmentProblems: enrichmentProblems(definition, enrichment),
      lineSourceProblems: validateLineSources(definition, lineSources),
    };
  });
}
