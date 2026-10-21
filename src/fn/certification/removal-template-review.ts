"use server";

import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";

import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { hasCertifierCredentials, resolveIsometricClient } from "@/data-access/certifier-credentials";
import { listPinnedRemovalTemplateIds, switchCreditBatchRemovalTemplate as switchTemplate } from "@/data-access/credit-batch-removal-template";
import { getLatestTemplateObservation, getPreviousTemplateObservation } from "@/data-access/removal-template-observations";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates } from "@/lib/isometric";
import { compareTemplateObservations, normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { readOnlyEntry } from "./removal-template-preview-core";
import {
  loadRemovalTemplateReviewSchema, removalTemplateReviewPreviewSchema, switchCreditBatchRemovalTemplateSchema,
  type RemovalTemplateReviewPreviewInput, type SwitchCreditBatchRemovalTemplateInput,
} from "@/schemas/removal-template-review";
import { withAction } from "../with-action";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";
import { removalTemplateVerdict } from "@/lib/certification/removal-template-verdict";
import { findListedRemovalTemplate } from "@/lib/certification/listed-removal-template";
import { removalTemplateReviewEntry } from "@/lib/certification/removal-template-review-entry";

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
      const stored = current?.observation ?? null;
      const previous = stored ? await getPreviousTemplateObservation(ctx, ISOMETRIC_PROVIDER, templateId, stored.id) : null;
      const changes = stored && previous ? compareTemplateObservations(previous, stored) : {};
      entries.push({
        ...removalTemplateReviewEntry({ templateId, template: current?.template ?? null, observation: stored,
          enrichmentProblems: current?.enrichmentProblems ?? [], lineSourceProblems: current?.lineSourceProblems ?? [],
          blueprintsForTemplate: current?.blueprintsForTemplate }, changes),
        isDefault, isPinned,
      });
    }
    return entries;
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
    const template = findListedRemovalTemplate(templates, parsed.removalTemplateId);
    const entry = removalTemplateReviewEntry({ templateId: template.id, template, observation: null });
    const selection = removalTemplateVerdict(entry);
    if (selection.blocker === "unsupportedSequestration") throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[selection.blocker]);
    const changingTemplate = batch.removalTemplateId !== parsed.removalTemplateId;
    if (changingTemplate && selection.setupBlocker) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[selection.setupBlocker]);
    if (changingTemplate) {
      const latest = await getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, template.id);
      if (!latest) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
      const stored = removalTemplateVerdict(removalTemplateReviewEntry({ templateId: template.id, template, observation: latest }));
      if (stored.blocker) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[stored.blocker]);
    }
    const facts = await loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: mapping.externalProjectId, blueprints: await listComponentBlueprints(client) });
    // A failed read is not a component to decide: say what actually blocks the switch.
    if (changingTemplate && !facts.observation) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
    if (changingTemplate) {
      const refreshed = removalTemplateVerdict(removalTemplateReviewEntry({ ...facts, template, templateId: template.id,
        definition: normalizeTemplateDefinition(template) }));
      if (refreshed.blocker) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[refreshed.blocker]);
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
    const template = findListedRemovalTemplate(templates, removalTemplateId);
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
