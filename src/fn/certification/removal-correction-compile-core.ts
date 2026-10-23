import type { CoveredContenders } from "@/lib/certification/covered-contenders";
import { changedGeneratedEvidence } from "./generated-evidence-comparison";
import { RemovalComparisonBlockedError } from "./removal-comparison-blocked-error";
import type { OrgContext } from "@/lib/auth/server";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import { getFacilityById } from "@/data-access/facilities";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { resolveScopeForRemoval } from "./removal-scope";
import { buildRemovalContext } from "./removal-context-build";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import { storedRemovalTemplateFacts } from "./stored-removal-template";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { prepareRemovalSubmission } from "./removal-submission-prepare";

/** Content comparison only; never authorizes a Removal mutation. */
export async function compileRemovalCorrectionContent(orgCtx: OrgContext, removalId: string, observation: RemovalTemplateObservation, coveredContenders?: CoveredContenders): Promise<Record<string, unknown> | null> {
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
  const context = await buildRemovalContext(orgCtx, scope, facilityFacts, { correctionRead: true, coveredContenders });
  const { prepared, blockers } = prepareRemovalSubmission(context);
  const comparisonBlockers = [...blockers, ...(context.removalEntryContext?.contributions.blockers ?? [])];
  if (comparisonBlockers.length) {
    throw new RemovalComparisonBlockedError(comparisonBlockers.map(blocker => blocker.message));
  }
  // The statement guard compares live attachments even when an eligibility read
  // failed or the last Removal resubmit has already closed the correction window.
  context.correctionWindowOpen = true;
  if (!prepared) return null;
  const semantic = (await buildRemovalSubmissionBuild({ orgCtx, removalId, ctx: context, prepared })).semanticPayload;
  const changedLedgers = await changedGeneratedEvidence(orgCtx, removalId, context);
  // Comparison-only facts: never enter the submission payload or its hash.
  return changedLedgers.length ? { ...semantic, changedGeneratedEvidence: changedLedgers } : semantic;
}
