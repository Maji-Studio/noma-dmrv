import type { OrgContext } from "@/lib/auth/server";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import { getFacilityById } from "@/data-access/facilities";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { resolveScopeForRemoval } from "./removal-scope";
import { buildRemovalContext } from "./certify-context-core";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import { storedRemovalTemplateFacts } from "./stored-removal-template";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { prepareRemovalSubmission } from "./removal-submission-prepare";

/** Content comparison only; never authorizes a Removal mutation. */
export async function compileRemovalCorrectionContent(orgCtx: OrgContext, removalId: string, observation: RemovalTemplateObservation, useCurrentEvidence = false): Promise<Record<string, unknown> | null> {
  const scope = await resolveScopeForRemoval(orgCtx, removalId);
  const [facility, mapping] = await Promise.all([
    getFacilityById(orgCtx, scope.facilityId),
    getCertifierProjectByFacility(orgCtx, scope.facilityId, "isometric"),
  ]);
  const templateFacts = storedRemovalTemplateFacts(observation);
  const facilityFacts: FacilityCertifierFacts = {
    facilityTimezone: facility.timezone, mapping, hasOrgCredentials: true, project: null,
    currentTemplate: templateFacts.template, missingCurrentTemplateId: null,
    templatesById: { [observation.externalTemplateId]: templateFacts },
    blueprintsForTemplate: templateFacts.blueprintsForTemplate, unresolvedBlueprintKeys: [],
    unbindableTemplateInputs: [], requiredTransportCategories: templateFacts.requiredTransportCategories,
  };
  // Suppress correction projections and storage summaries only. Keep all
  // compilation validation; invalid current records cannot equal sent content.
  const context = await buildRemovalContext(orgCtx, scope, facilityFacts, undefined, false, true);
  const { prepared, blockers } = prepareRemovalSubmission(context);
  if (useCurrentEvidence && (blockers.length || context.removalEntryContext?.contributions.blockers.length)) return null;
  // The statement guard compares live attachments even when an eligibility read
  // failed or the last Removal resubmit has already closed the correction window.
  if (useCurrentEvidence) context.correctionWindowOpen = true;
  return prepared ? (await buildRemovalSubmissionBuild({ orgCtx, removalId, ctx: context, prepared })).semanticPayload : null;
}
