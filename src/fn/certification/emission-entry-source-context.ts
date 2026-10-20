import type { OrgContext } from "@/lib/auth/server";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import { resolveScopeForRemoval } from "./removal-scope";
import { getLatestTemplateObservations } from "@/data-access/removal-template-observations";
import { loadBatchEmissionContext } from "./batch-emission-context";
import { frozenEntriesForAttempt, loadRemovalEntryContext } from "./removal-entry-context";

/** The mirror picker derives ownership and frozen sets from local state only.
 * Compilation still loads fresh registry facts and fails closed independently.
 */
export async function loadEntrySourceContributions(ctx: OrgContext, removalId: string) {
  if (!emissionsEntriesEnabled()) return undefined;
  const scope = await resolveScopeForRemoval(ctx, removalId);
  const observations = await getLatestTemplateObservations(ctx, ISOMETRIC_PROVIDER,
    [...new Set(scope.memberBatches.flatMap((batch) => batch.removalTemplateId ? [batch.removalTemplateId] : []))]);
  const facility = { templatesById: Object.fromEntries(observations.map((observation) =>
    [observation.externalTemplateId, { observation }])) };
  const facts = await loadBatchEmissionContext(ctx, scope.facilityId, scope.memberBatches, facility);
  const latest = await getLatestSubmission(ctx, { provider: ISOMETRIC_PROVIDER,
    submissionType: REMOVAL_SUBMISSION_TYPE, localEntityType: REMOVAL_ENTITY_TYPE, localEntityId: removalId });
  return (await loadRemovalEntryContext(ctx, scope, facts, facility, frozenEntriesForAttempt(latest, facts)))?.contributions;
}
