/**
 * Readiness of the facility's draft Removals, for the dashboard's attention
 * list. It reuses the Removals list's read path (`buildRemovalContext`, then
 * `toRemovalReadinessFacts` + `deriveRemovalReadiness`), so the dashboard and
 * the list can never disagree about "N to fix".
 *
 * Not a server action (no "use server"): the dashboard read model calls it
 * with the request's OrgContext. Cost per dashboard load: one Removal list
 * query and one latest-submission query; then, only when a draft exists, the
 * facility facts once and one Removal context build per draft, in chunks.
 */
import type { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import { getLatestSubmissionsForEntities } from "@/data-access/certification";
import { listRemovalsForFacility } from "@/data-access/certifier-removals";
import { requireOrgScope } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { isRemovalSubmissionInterruptedFromSubmission } from "@/lib/certification/from-submission";
import { deriveRemovalReadiness } from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import type { DraftRemovalReadiness } from "@/lib/certification/removal-attention";
import { deriveRemovalStatus, type LocalSubmissionStatus } from "@/lib/certification/status";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { logger } from "@/lib/log";
import { buildRemovalContext, loadFacilityCertifierFacts, resolveScopeForRemoval } from "@/fn/certification/certify-context-core";

/** Same bound the Removals list uses for its per-Removal builds. */
const READINESS_CONCURRENCY = 8;

export async function loadDraftRemovalReadiness(orgCtx: OrgContext, facilityId: string): Promise<DraftRemovalReadiness[]> {
  requireOrgScope(orgCtx);
  const removalRows = await listRemovalsForFacility(orgCtx, facilityId);
  if (removalRows.length === 0) return [];
  const submissions = await getLatestSubmissionsForEntities(
    orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityIds: removalRows.map((removal) => removal.id),
    },
    facilityId,
  );
  // A draft is a Removal never sent, or whose attempt left nothing running or interrupted.
  const drafts = removalRows.filter((removal) => {
    const latest = submissions.get(removal.id) ?? null;
    return (
      deriveRemovalStatus({
        local: (latest?.status ?? null) as LocalSubmissionStatus | null,
        lockInFlight: latest ? isLockedInFlight(latest) : false,
        submissionInterrupted: isRemovalSubmissionInterruptedFromSubmission(latest, {
          startedOn: removal.startedOn ?? null,
          completedOn: removal.completedOn ?? null,
        }),
      }).kind === "not-submitted"
    );
  });
  if (drafts.length === 0) return [];

  // Best effort: a failing facts load or draft build drops those rows, never the dashboard.
  let facilityFacts: Awaited<ReturnType<typeof loadFacilityCertifierFacts>>;
  try {
    facilityFacts = await loadFacilityCertifierFacts(orgCtx, facilityId);
  } catch {
    logger.warn({ facilityId }, "Draft Removal readiness skipped: facility facts failed to load");
    return [];
  }
  const carryReads = new Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>>();
  const result: DraftRemovalReadiness[] = [];
  for (let i = 0; i < drafts.length; i += READINESS_CONCURRENCY) {
    const chunk = drafts.slice(i, i + READINESS_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (removal) => {
        const scope = await resolveScopeForRemoval(orgCtx, removal.id);
        const ctx = await buildRemovalContext(orgCtx, scope, facilityFacts, { carryReads });
        return {
          removalId: removal.id,
          code: removal.code,
          createdAt: removal.createdAt,
          readiness: deriveRemovalReadiness(toRemovalReadinessFacts(ctx)),
        };
      }),
    );
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") result.push(outcome.value);
      else logger.warn({ removalId: chunk[index]?.id }, "Draft Removal readiness skipped: build failed");
    });
  }
  return result;
}
