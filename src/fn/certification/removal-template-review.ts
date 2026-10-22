"use server";

import { getCertifierProjectByFacility } from "@/data-access/certification";
import { hasCertifierCredentials, resolveIsometricClient } from "@/data-access/certifier-credentials";
import { listPinnedRemovalTemplateIds } from "@/data-access/credit-batch-removal-template";
import { getLatestTemplateObservation, getPreviousTemplateObservation } from "@/data-access/removal-template-observations";
import { requireOrgFacility } from "@/data-access/utils";

import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates } from "@/lib/isometric";
import { compareTemplateObservations } from "@/lib/isometric/template-observations";
import { readOnlyEntry } from "./removal-template-preview-core";
import {
  loadRemovalTemplateReviewSchema, removalTemplateReviewPreviewSchema,
  type RemovalTemplateReviewPreviewInput,
} from "@/schemas/removal-template-review";
import { withAction } from "../with-action";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";

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
      ...(mapping.removalTemplateId ? [mapping.removalTemplateId] : []),
      ...pinnedIds, ...removalTemplates.map((template) => template.id),
    ])];
    const entries = [];
    // Keep observation transactions ordered to limit pool pressure.
    for (const templateId of templateIds) {
      const template = removalTemplates.find((candidate) => candidate.id === templateId);
      const isCurrent = templateId === mapping.removalTemplateId;
      const isPinned = pinnedIds.includes(templateId);
      const latest = template && !isCurrent && !isPinned
        ? await getLatestTemplateObservation(ctx, ISOMETRIC_PROVIDER, templateId) : null;
      if (template && !isCurrent && !isPinned && !latest) {
        entries.push({ ...await readOnlyEntry(client, template, blueprints, null, mapping.externalProjectId), isCurrent, isPinned });
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
        isCurrent, isPinned,
      });
    }
    return entries;
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
      isCurrent: template.id === mapping.removalTemplateId,
      isPinned: pinnedIds.includes(template.id),
    };
  });
}
