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
 * query and one latest-submission query; then, only when a draft or returned
 * Removal exists, the facility facts once and one context build per Removal,
 * in chunks. Failed readiness keeps drafts with an unavailable marker.
 */
import { pgErrorCode } from "@/db/errors";
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
import type { DraftRemovalReadiness, RemovalAttentionSources } from "@/lib/certification/removal-attention";
import { deriveRemovalStatus, type LocalSubmissionStatus } from "@/lib/certification/status";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import { buildRemovalContext, loadFacilityCertifierFacts, resolveScopeForRemoval } from "@/lib/certification/certify-context-core";

/** Same bound the Removals list uses for its per-Removal builds. */
const READINESS_CONCURRENCY = 8;

const NO_SOURCES: RemovalAttentionSources = { drafts: [], rejected: [], returned: [] };

/** Only safe error fields cross the log boundary; driver details and parameters stay out. */
function errorFields(error: unknown) {
  const cause = error instanceof Error && typeof error.cause === "object" && error.cause !== null
    ? error.cause : undefined;
  return {
    errorType: error instanceof Error ? sanitizeErrorMessage(error.name) : typeof error,
    errorCode: pgErrorCode(error),
    errorMessage: sanitizeErrorMessage(error),
    errorCauseMessage: cause && "message" in cause && typeof cause.message === "string"
      ? sanitizeErrorMessage(cause.message) : undefined,
  };
}

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
  // Returned rows stay best effort: a failed lineage, facts or context read leaves them out.
  const returnedIds = submitted.length
    ? await loadReturnedRemovalIds(
        orgCtx,
        submitted.map((removal) => ({ removalId: removal.id, ghgStatementId: removal.ghgStatementId ?? null })),
      ).catch((error: unknown) => {
        logger.warn({ facilityId, ...errorFields(error) }, "Returned Removal rows skipped: lineage failed to load");
        return new Set<string>();
      })
    : new Set<string>();
  const returned = submitted.filter((removal) => returnedIds.has(removal.id));
  if (drafts.length === 0 && returned.length === 0) return { ...NO_SOURCES, rejected };

  const unavailableDraft = (removal: Row): DraftRemovalReadiness => ({
    removalId: removal.id,
    code: removal.code,
    createdAt: removal.createdAt,
    readiness: null,
  });
  let facilityFacts: Awaited<ReturnType<typeof loadFacilityCertifierFacts>>;
  try {
    facilityFacts = await loadFacilityCertifierFacts(orgCtx, facilityId);
  } catch (error: unknown) {
    logger.warn({ facilityId, ...errorFields(error) }, "Removal readiness unavailable: facility facts failed to load");
    return { drafts: drafts.map(unavailableDraft), rejected, returned: [] };
  }
  const carryReads = new Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>>();
  /** Bounded context builds; drafts keep a fallback row when a build or projection fails. */
  async function project<T>(
    removals: readonly Row[],
    pick: (removal: Row, ctx: Awaited<ReturnType<typeof buildRemovalContext>>) => T,
    fallback?: (removal: Row) => T,
  ): Promise<T[]> {
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
        else {
          const removal = chunk[index];
          logger.warn({ facilityId, removalId: removal.id, ...errorFields(outcome.reason) }, "Removal attention build failed");
          if (fallback) result.push(fallback(removal));
        }
      });
    }
    return result;
  }
  const [draftRows, returnedRows] = await Promise.all([
    project<DraftRemovalReadiness>(drafts, (removal, ctx) => ({
      removalId: removal.id,
      code: removal.code,
      createdAt: removal.createdAt,
      readiness: deriveRemovalReadiness(toRemovalReadinessFacts(ctx)),
    }), unavailableDraft),
    project(returned, (removal, ctx) => ({
      removalId: removal.id,
      code: removal.code,
      createdAt: removal.createdAt,
      correction: correctionForRemoval(removal.id, Object.values(ctx.entryCorrectionsByBatchId ?? {}).flat()),
    })),
  ]);
  return { drafts: draftRows, rejected, returned: returnedRows };
}
