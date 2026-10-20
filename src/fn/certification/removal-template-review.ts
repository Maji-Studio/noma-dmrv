"use server";

import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";

import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { hasCertifierCredentials, resolveIsometricClient } from "@/data-access/certifier-credentials";
import { listPinnedRemovalTemplateIds, switchCreditBatchRemovalTemplate as switchTemplate } from "@/data-access/credit-batch-removal-template";
import { getLatestTemplateObservation, getPreviousTemplateObservation, reviewLineContracts } from "@/data-access/removal-template-observations";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates, type IsometricClient, type IsometricComponentBlueprint, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { compareTemplateObservations, enrichmentProblems, normalizeTemplateDefinition, lineSourcesForObservation, validateLineSources, type ComponentChange } from "@/lib/isometric/template-observations";
import { enrichmentForObservation } from "./observe-removal-template";
import {
  loadRemovalTemplateReviewSchema, removalTemplateReviewPreviewSchema, reviewRemovalTemplateLinesSchema, switchCreditBatchRemovalTemplateSchema,
  type RemovalTemplateReviewPreviewInput, type ReviewRemovalTemplateLinesInput, type SwitchCreditBatchRemovalTemplateInput,
} from "@/schemas/removal-template-review";
import { withAction } from "../with-action";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";
import { removalTemplateReviewLines as reviewLines } from "@/lib/certification/removal-template-review-lines";
import { isTemplateReady, linesToDecideCount } from "@/lib/certification/removal-template-readiness";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";

async function readOnlyEntry(
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
    lines: reviewLines(definition, lineSources, {}, blueprints, template),
    enrichmentProblems: enrichmentProblems(definition, enrichment),
    lineSourceProblems: validateLineSources(definition, lineSources),
  };
}

export async function loadRemovalTemplateReview(facilityId: string) {
  return withAction(async (ctx) => {
    const id = loadRemovalTemplateReviewSchema.parse(facilityId);
    await requireOrgFacility(ctx, id);
    const mapping = await getCertifierProjectByFacility(ctx, id, ISOMETRIC_PROVIDER);
    if (!mapping || !await hasCertifierCredentials(ctx, ISOMETRIC_PROVIDER)) return [];
    const pinnedIds = await listPinnedRemovalTemplateIds(ctx, id);
    const client = await resolveIsometricClient(ctx);
    const [templates, blueprints] = await Promise.all([
      safeListIfConfigured(() => listGhgEntryTemplates(client, mapping.externalProjectId)),
      safeListIfConfigured(() => listComponentBlueprints(client)),
    ]);
    const removalTemplates = templates.filter((template) => template.credit_type === "REMOVAL");
    const templateIds = [...new Set([
      ...(mapping.defaultRemovalTemplateId ? [mapping.defaultRemovalTemplateId] : []),
      ...pinnedIds, ...removalTemplates.map((template) => template.id),
    ])];
    const entries = [];
    // Keep observation transactions ordered to limit pool pressure.
    for (const templateId of templateIds) {
      const template = removalTemplates.find((candidate) => candidate.id === templateId);
      const isDefault = templateId === mapping.defaultRemovalTemplateId;
      const isPinned = pinnedIds.includes(templateId);
      const latest = template && !isDefault && !isPinned
        ? await getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, templateId) : null;
      if (template && !isDefault && !isPinned && !latest) {
        entries.push({ ...await readOnlyEntry(client, template, blueprints, null, mapping.externalProjectId), isDefault, isPinned });
        continue;
      }
      const current = template ? await loadRemovalTemplateFacts(ctx, {
        client, template, externalProjectId: mapping.externalProjectId, blueprints,
      }) : null;
      const observation = current?.observation ?? null;
      const previous = observation ? await getPreviousTemplateObservation(ctx, ISOMETRIC_PROVIDER, templateId, observation.id) : null;
      const changes = observation && previous ? compareTemplateObservations(previous, observation) : {};
      const definition = observation?.definition ?? (current ? normalizeTemplateDefinition(current.template) : null);
      entries.push({
        templateId, template: current?.template ?? null, observation,
        isDefault, isPinned,
        availability: current ? "listed" as const : "missing" as const,
        preview: false as boolean,
        enrichment: observation?.enrichment ?? null,
        changes,
        lines: definition ? reviewLines(definition, observation?.lineSources ?? {}, changes, current?.blueprintsForTemplate ?? [], current?.template) : [],
        enrichmentProblems: current?.enrichmentProblems ?? [], lineSourceProblems: current?.lineSourceProblems ?? [],
      });
    }
    return entries;
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
    const changingTemplate = batch.removalTemplateId !== parsed.removalTemplateId;
    if (changingTemplate) {
      const latest = await getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, template.id);
      if (!latest) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
      const storedRead = {
        availability: "listed" as const, template, observation: latest,
        enrichmentProblems: enrichmentProblems(latest.definition, latest.enrichment),
        lineSourceProblems: validateLineSources(latest.definition, latest.lineSources),
        lines: reviewLines(latest.definition, latest.lineSources, {}, [], template),
      };
      if (!isTemplateReady(storedRead)) throw new SafeError(linesToDecideCount(storedRead) > 0
        ? REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview : REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
    }
    const facts = await loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: mapping.externalProjectId, blueprints: await listComponentBlueprints(client) });
    // A failed read is not a line to decide: say what actually blocks the switch.
    if (changingTemplate && !facts.observation) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
    if (changingTemplate) {
      const refreshedRead = {
        availability: "listed" as const, template, observation: facts.observation,
        enrichmentProblems: facts.enrichmentProblems, lineSourceProblems: facts.lineSourceProblems,
        lines: reviewLines(normalizeTemplateDefinition(template), facts.observation?.lineSources ?? {}, {}, facts.blueprintsForTemplate, template),
      };
      if (!isTemplateReady(refreshedRead)) throw new SafeError(linesToDecideCount(refreshedRead) > 0
        ? REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview : REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
    }
    return switchTemplate(ctx, parsed);
  });
}

/**
 * One listed Removal template, read for review without observing it. The
 * switch dialog's warning deep-links here for a template no credit batch pins
 * yet, so nothing is stored: lines come from the latest stored observation
 * when the template still matches it, else from the proposals an observation
 * would make, and enrichment uses the same TTL as Switch. The entry is read-only
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
    const [latest, blueprints, pinnedIds] = await Promise.all([
      getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, template.id),
      listComponentBlueprints(client),
      listPinnedRemovalTemplateIds(ctx, facilityId),
    ]);
    return {
      ...await readOnlyEntry(client, template, blueprints, latest, mapping.externalProjectId),
      isDefault: template.id === mapping.defaultRemovalTemplateId,
      isPinned: pinnedIds.includes(template.id),
    };
  });
}
