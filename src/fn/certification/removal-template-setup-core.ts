import { db } from "@/db";
import { getFacilityById } from "@/data-access/facilities";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { requireOrgFacility } from "@/data-access/utils";
import { getLatestTemplateObservation, getPreviousTemplateObservation } from "@/data-access/removal-template-observations";
import { applySetupInTransaction, listSetupCreditBatches, staleSetupTemplate } from "@/data-access/removal-template-setup";
import { hasOrgRole, requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { listComponentBlueprints, listGhgEntryTemplates, listProjects } from "@/lib/isometric";
import { compareTemplateObservations, fullFingerprint, normalizeTemplateDefinition, semanticFingerprint, validateLineSources } from "@/lib/isometric/template-observations";
import { isTemplateReady, linesToDecideCount } from "@/lib/certification/removal-template-readiness";
import { setupPlan, templateFitsFacility } from "@/lib/certification/removal-template-setup-plan";
import { setupBlockedReason } from "@/lib/certification/removal-template-setup-blockers";
import { setupPlanFingerprint } from "@/lib/certification/removal-template-setup-fingerprint";
import { reviewLineSources } from "@/lib/certification/removal-template-review-sources";
import { removalTemplateReviewLines } from "@/lib/certification/removal-template-review-lines";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { readOnlyEntry } from "./removal-template-preview-core";

async function setupContext(ctx: OrgContext, facilityId: string) {
  await requireOrgFacility(ctx, facilityId);
  const facility = await getFacilityById(ctx, facilityId);
  const mapping = await getCertifierProjectByFacility(ctx, facilityId, "isometric");
  if (!mapping) throw new SafeError("Link this facility to an Isometric project first.");
  const client = await resolveIsometricClient(ctx);
  const templates = await listGhgEntryTemplates(client, mapping.externalProjectId);
  return { facility, mapping, client, templates };
}

export async function loadRemovalTemplateSetupCore(ctx: OrgContext, facilityId: string) {
  const viewerCanManage = hasOrgRole(ctx, "admin");
  const { facility, mapping, client, templates } = await setupContext(ctx, facilityId);
  const [batches, blueprints, projects] = await Promise.all([
    listSetupCreditBatches(ctx, facilityId), listComponentBlueprints(client), listProjects(client),
  ]);
  const fitting = [];
  const notFitting = [];
  for (const template of templates.filter((candidate) => candidate.credit_type === "REMOVAL")) {
    const fit = templateFitsFacility(template, facility.durabilityOption);
    if ("reason" in fit) { notFitting.push({ id: template.id, name: template.display_name, reason: fit.reason }); continue; }
    const latest = await getLatestTemplateObservation(ctx, "isometric", template.id);
    const used = template.id === mapping.defaultRemovalTemplateId || batches.some((batch) => batch.removalTemplateId === template.id);
    const facts = viewerCanManage && used ? await loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: mapping.externalProjectId, blueprints }) : null;
    const preview = facts ? null : await readOnlyEntry(client, template, blueprints, latest, mapping.externalProjectId);
    const observation = facts?.observation ?? null;
    const definition = normalizeTemplateDefinition(template);
    const enrichment = observation?.enrichment ?? preview?.enrichment ?? {};
    const fingerprints = {
      semanticFingerprint: semanticFingerprint(definition, enrichment),
      fullFingerprint: fullFingerprint(definition, enrichment),
    };
    // A matching preview still needs the preceding observation to label
    // component changes in the review lines.
    const matchingLatest = latest?.semanticFingerprint === fingerprints.semanticFingerprint &&
      latest.fullFingerprint === fingerprints.fullFingerprint ? latest : null;
    const currentObservation = observation ?? matchingLatest;
    const sources = reviewLineSources(observation?.lineSources ?? Object.fromEntries((preview?.lines ?? []).flatMap((line) => line.contract ? [[line.component.id, line.contract]] : [])));
    const previous = currentObservation
      ? await getPreviousTemplateObservation(ctx, "isometric", template.id, currentObservation.id) : latest;
    const changes = previous ? compareTemplateObservations(previous, { definition, enrichment }) : {};
    const problems = facts?.lineSourceProblems ?? preview?.lineSourceProblems ?? validateLineSources(definition, sources);
    const entry = { availability: "listed" as const, template, observation: currentObservation,
      enrichmentProblems: facts?.enrichmentProblems ?? preview?.enrichmentProblems ?? [], lineSourceProblems: problems,
      lines: removalTemplateReviewLines(definition, sources, changes, blueprints, template) };
    const plan = setupPlan(definition, sources, problems);
    fitting.push({ id: template.id, name: template.display_name,
      componentCount: entry.lines.length, plan, planFingerprint: setupPlanFingerprint(plan),
      ready: isTemplateReady(entry), toDecideCount: linesToDecideCount(entry),
      blockedReason: setupBlockedReason(template, entry.enrichmentProblems),
      ...fingerprints,
    });
  }
  return { facility: { id: facility.id, name: facility.name },
    projectName: projects.find((project) => project.id === mapping.externalProjectId)?.name ?? null,
    tier: facility.durabilityOption, fitting, notFitting,
    defaultRemovalTemplateId: mapping.defaultRemovalTemplateId,
    defaultToDecideCount: fitting.find((template) => template.id === mapping.defaultRemovalTemplateId)?.toDecideCount ?? 0,
    batchesWithoutTemplate: batches.filter((batch) => !batch.removalTemplateId).map(({ id, code, version }) => ({ id, code, version })),
    batchesOnOtherTemplates: batches.filter((batch) => batch.removalTemplateId && batch.removalTemplateId !== mapping.defaultRemovalTemplateId)
      .map((batch) => ({ code: batch.code, removalTemplateId: batch.removalTemplateId, templateName: templates.find((template) => template.id === batch.removalTemplateId)?.display_name ?? null })),
    viewerCanManage,
  };
}

export async function applyRemovalTemplateSetupCore(ctx: OrgContext, input: ApplyRemovalTemplateSetupInput) {
  requireOrgRole(ctx, "admin");
  const { facility, mapping, client, templates } = await setupContext(ctx, input.facilityId);
  const template = templates.find((candidate) => candidate.id === input.removalTemplateId);
  if (!template) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFound);
  const fit = templateFitsFacility(template, facility.durabilityOption);
  if ("reason" in fit) throw new SafeError(fit.reason);
  const facts = await loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: mapping.externalProjectId, blueprints: await listComponentBlueprints(client) });
  const observation = facts.observation;
  if (!observation) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
  if (observation.semanticFingerprint !== input.fingerprints.semanticFingerprint || observation.fullFingerprint !== input.fingerprints.fullFingerprint) throw staleSetupTemplate(template.id);
  return db.transaction((tx) => applySetupInTransaction(ctx, tx, input, template, observation));
}
