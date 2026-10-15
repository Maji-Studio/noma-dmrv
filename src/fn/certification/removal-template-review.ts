"use server";

import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { switchCreditBatchRemovalTemplate as switchTemplate } from "@/data-access/credit-batch-removal-template";
import { getPreviousTemplateObservation, reviewLineContracts } from "@/data-access/removal-template-observations";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates } from "@/lib/isometric";
import { allowedEntryPolicies, catalogCandidates, compareTemplateObservations, normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import {
  loadRemovalTemplateReviewSchema, reviewRemovalTemplateLinesSchema, switchCreditBatchRemovalTemplateSchema,
  type ReviewRemovalTemplateLinesInput, type SwitchCreditBatchRemovalTemplateInput,
} from "@/schemas/removal-template-review";
import { withAction } from "../with-action";
import { loadFacilityCertifierFacts } from "./facility-certifier-facts";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { ISOMETRIC_PROVIDER } from "./shared";

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
        changes,
        lines: definition?.groups.flatMap((group) => group.components.map((component) => ({
          component, groupKey: group.key, groupName: group.displayName, contract: observation?.lineSources[component.id] ?? { scope: "unassigned" as const, entryPolicy: "none" as const, origin: "proposed" as const },
          catalogCandidates: catalogCandidates(component, group.key), allowedEntryPolicies: allowedEntryPolicies(component),
          change: changes[component.id] ?? "added" as const,
        }))) ?? [],
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
    if (!template) throw new SafeError("Template no longer exists in Isometric.");
    if (template.credit_type !== "REMOVAL") throw new SafeError("Choose a Removal template for this credit batch.");
    await loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: mapping.externalProjectId, blueprints: await listComponentBlueprints(client) });
    return switchTemplate(ctx, parsed);
  });
}
