/**
 * What the dashboard's attention list needs to know about the facility's
 * Removals: the readiness of each draft, the Removals whose last submission
 * was rejected, and the submitted Removals the verifier returned (with their
 * correction state). It reuses the Removals list's read path
 * (`buildRemovalContext`, then `toRemovalReadinessFacts` +
 * `deriveRemovalReadiness`, `correctionForRemoval`), so the dashboard and the
 * list can never disagree.
 *
 * Not a server action (no "use server"): the dashboard read model calls it
 * with the request's OrgContext. Cost per dashboard load: one Removal list
 * query and one latest-submission query; then, only when a draft exists, the
 * facility facts once and one Removal context build per draft or returned Removal, in chunks.
 */
import type { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import { getLatestSubmissionsForEntities } from "@/data-access/certification";
import { listRemovalsForFacility } from "@/data-access/certifier-removals";
import { loadReturnedRemovalIds } from "@/data-access/dashboard-returned-removals";
import { requireOrgScope } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { isRemovalSubmissionInterruptedFromSubmission } from "@/lib/certification/from-submission";
import { deriveRemovalReadiness } from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { correctionForRemoval } from "@/lib/certification/removal-entry-correction";
import type { RemovalAttentionSources } from "@/lib/certification/removal-attention";
import { deriveRemovalStatus, type LocalSubmissionStatus } from "@/lib/certification/status";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { logger } from "@/lib/log";
import { buildRemovalContext, loadFacilityCertifierFacts, resolveScopeForRemoval } from "@/lib/certification/certify-context-core";

/** Same bound the Removals list uses for its per-Removal builds. */
const READINESS_CONCURRENCY = 8;

const NO_SOURCES: RemovalAttentionSources = { drafts: [], rejected: [], returned: [] };

export async function loadRemovalAttentionSources(orgCtx: OrgContext, facilityId: string): Promise<RemovalAttentionSources> {
  requireOrgScope(orgCtx);
  const removalRows = await listRemovalsForFacility(orgCtx, facilityId);
  if (removalRows.length === 0) return NO_SOURCES;
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
  type Row = (typeof removalRows)[number];
  const kindOf = (removal: Row) => {
    const latest = submissions.get(removal.id) ?? null;
    return deriveRemovalStatus({
      local: (latest?.status ?? null) as LocalSubmissionStatus | null,
      lockInFlight: latest ? isLockedInFlight(latest) : false,
      submissionInterrupted: isRemovalSubmissionInterruptedFromSubmission(latest, {
        startedOn: removal.startedOn ?? null,
        completedOn: removal.completedOn ?? null,
      }),
    }).kind;
  };
  // A draft is a Removal never sent, or whose attempt left nothing running or interrupted.
  const drafts = removalRows.filter((removal) => kindOf(removal) === "not-submitted");
  const rejected = removalRows
    .filter((removal) => kindOf(removal) === "rejected")
    .map((removal) => ({ removalId: removal.id, code: removal.code, createdAt: removal.createdAt }));
  const submitted = removalRows.filter((removal) => kindOf(removal) === "submitted");
  // Best effort: a failing lineage read, facts load or Removal build drops those rows, never the dashboard.
  const returnedIds = submitted.length
    ? await loadReturnedRemovalIds(
        orgCtx,
        submitted.map((removal) => ({ removalId: removal.id, ghgStatementId: removal.ghgStatementId ?? null })),
      ).catch(() => {
        logger.warn({ facilityId }, "Returned Removal rows skipped: lineage failed to load");
        return new Set<string>();
      })
    : new Set<string>();
  const returned = submitted.filter((removal) => returnedIds.has(removal.id));
  if (drafts.length === 0 && returned.length === 0) return { ...NO_SOURCES, rejected };

  let facilityFacts: Awaited<ReturnType<typeof loadFacilityCertifierFacts>>;
  try {
    facilityFacts = await loadFacilityCertifierFacts(orgCtx, facilityId);
  } catch {
    logger.warn({ facilityId }, "Draft Removal readiness skipped: facility facts failed to load");
    return { ...NO_SOURCES, rejected };
  }
  const carryReads = new Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>>();
  /** One Removal context per Removal, in bounded chunks; a failed build is logged by id and left out. */
  async function project<T>(removals: readonly Row[], pick: (removal: Row, ctx: Awaited<ReturnType<typeof buildRemovalContext>>) => T): Promise<T[]> {
    const result: T[] = [];
    for (let i = 0; i < removals.length; i += READINESS_CONCURRENCY) {
      const chunk = removals.slice(i, i + READINESS_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (removal) => {
          const scope = await resolveScopeForRemoval(orgCtx, removal.id);
          return pick(removal, await buildRemovalContext(orgCtx, scope, facilityFacts, { carryReads }));
        }),
      );
      settled.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") result.push(outcome.value);
        else logger.warn({ removalId: chunk[index]?.id }, "Removal attention skipped: build failed");
      });
    }
    return result;
  }
  const [draftRows, returnedRows] = await Promise.all([
    project(drafts, (removal, ctx) => ({
      removalId: removal.id,
      code: removal.code,
      createdAt: removal.createdAt,
      readiness: deriveRemovalReadiness(toRemovalReadinessFacts(ctx)),
    })),
    project(returned, (removal, ctx) => ({
      removalId: removal.id,
      code: removal.code,
      createdAt: removal.createdAt,
      correction: correctionForRemoval(removal.id, Object.values(ctx.entryCorrectionsByBatchId ?? {}).flat()),
    })),
  ]);
  return { drafts: draftRows, rejected, returned: returnedRows };
}
