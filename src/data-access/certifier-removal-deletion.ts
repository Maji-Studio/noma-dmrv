import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierRemovals,
} from "@/db/schema/certification";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_METADATA_KEYS,
  getMetadataValue,
  isSubmissionAttemptInterrupted,
} from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "@/lib/isometric/utils/constants";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { logger } from "@/lib/log";
import { requireOrgScope } from "./utils";

/**
 * Deleting a Removal that never finalized.
 *
 * A submission that failed or was interrupted after "Creating Removal in
 * Isometric" leaves a DRAFT GHG Entry (and possibly Biochar Applications) on
 * the registry while the local ledger row stays a draft. Operators must be
 * able to remove that Removal, and the registry records must go with it.
 *
 * The flow has three seams so the network calls never run inside a database
 * transaction:
 *   1. `claimRemovalDeletion` verifies eligibility under the Removal row lock
 *      and the shared artifact lock, then re-locks the draft ledger row with
 *      the `deleting` attempt outcome so a concurrent submit is refused for
 *      the lock TTL.
 *   2. The caller deletes the registry records.
 *   3. `finalizeRemovalDeletion` re-reads the ledger to prove nothing was
 *      submitted in between, marks the ledger rows, removes the Biochar
 *      Application registrations so their supplier references are free for a
 *      later Removal, releases production-claim reservations and credit batch
 *      slices, and deletes the Removal row.
 * `releaseRemovalDeletionClaim` undoes step 1 when step 2 fails.
 *
 * Eligibility is the inverse of "submitted successfully": any ledger row in
 * a finalized status refuses deletion. Membership in a GHG Statement refuses
 * it too.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const FINALIZED_SUBMISSION_STATUSES = [
  "submitted",
  "accepted",
  "superseded",
] as const;
const DELETED_REGISTRATION_STATUS = "deleted" as const;
const DRAFT_LEDGER_STATUS = "draft" as const;
const DELETED_LEDGER_STATUS = "rejected" as const;
const DELETION_METADATA_KEY = "deletion";

export const REMOVAL_DELETE_SUBMITTED_ERROR =
  "This Removal was submitted to Isometric and cannot be deleted.";
export const REMOVAL_DELETE_STATEMENT_ERROR =
  "This Removal belongs to a GHG Statement and cannot be deleted.";
export const REMOVAL_DELETE_IN_FLIGHT_ERROR =
  "A submission attempt is still running for this Removal. Wait for it to finish, then try again.";
const REMOVAL_DELETE_MISSING_ERROR =
  "This Removal no longer exists. Refresh the page.";
export const REMOVAL_DELETE_CHANGED_ERROR =
  "This Removal changed while it was being deleted. Refresh the page and review its status.";

export interface RemovalDeletionClaim {
  removalId: string;
  facilityId: string;
  /** Every ledger row for this Removal; all are draft or rejected. */
  submissionIds: string[];
  /** The draft ledger row re-locked for the deletion window, if one existed. */
  lockedSubmission: {
    id: string;
    lockedAt: Date;
    priorAttemptOutcome: string | null;
  } | null;
  /** Registry GHG Entry IDs recorded on the ledger rows. */
  externalRemovalIds: string[];
  /**
   * Biochar Application registrations this Removal opened. A confirmed one
   * carries the registry ID; a `creating` one only carries the supplier
   * reference its interrupted POST used, which the caller resolves against
   * the registry before deciding whether anything exists to delete.
   */
  biocharApplications: Array<{
    registrationId: string;
    externalApplicationId: string | null;
    supplierReference: string;
  }>;
}

export interface RemovalDeletionRegistryOutcome {
  deletedGhgEntryIds: string[];
  deletedBiocharApplicationIds: string[];
}

async function lockRemovalRow(
  ctx: OrgContext,
  tx: Tx,
  facilityId: string,
  removalId: string,
): Promise<{ id: string; ghgStatementId: string | null }> {
  const [removal] = await tx
    .select({
      id: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(certifierRemovals)
    .where(
      and(
        eq(certifierRemovals.id, removalId),
        eq(certifierRemovals.facilityId, facilityId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!removal) throw new SafeError(REMOVAL_DELETE_MISSING_ERROR);
  if (removal.ghgStatementId !== null) {
    throw new SafeError(REMOVAL_DELETE_STATEMENT_ERROR);
  }
  return removal;
}

export async function claimRemovalDeletion(
  ctx: OrgContext,
  facilityId: string,
  removalId: string,
): Promise<RemovalDeletionClaim> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    await lockRemovalRow(ctx, tx, facilityId, removalId);
    // Same lock order as discard and submit: Removal row, then the shared
    // artifact lock, so a concurrent submit either finishes its claim first
    // (and we see its in-flight lock) or waits for this decision.
    await acquireCertificationArtifactLocksSorted(tx, [
      {
        provider: ISOMETRIC_PROVIDER,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityId: removalId,
      },
    ]);

    const rows = await tx
      .select({
        id: certificationSubmissions.id,
        status: certificationSubmissions.status,
        externalId: certificationSubmissions.externalId,
        lockedAt: certificationSubmissions.lockedAt,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.provider, ISOMETRIC_PROVIDER),
          eq(certificationSubmissions.submissionType, REMOVAL_ENTITY_TYPE),
          eq(certificationSubmissions.localEntityType, REMOVAL_ENTITY_TYPE),
          eq(certificationSubmissions.localEntityId, removalId),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      );

    if (
      rows.some((row) =>
        (FINALIZED_SUBMISSION_STATUSES as readonly string[]).includes(
          row.status,
        ),
      )
    ) {
      throw new SafeError(REMOVAL_DELETE_SUBMITTED_ERROR);
    }

    const drafts = rows.filter((row) => row.status === DRAFT_LEDGER_STATUS);
    for (const draft of drafts) {
      if (
        isLockedInFlight(draft) &&
        !isSubmissionAttemptInterrupted(draft.metadata)
      ) {
        throw new SafeError(REMOVAL_DELETE_IN_FLIGHT_ERROR);
      }
    }

    let lockedSubmission: RemovalDeletionClaim["lockedSubmission"] = null;
    const lockedAt = new Date();
    for (const draft of drafts) {
      const priorOutcome = getMetadataValue(
        draft.metadata,
        SUBMISSION_METADATA_KEYS.lastAttemptOutcome,
      );
      const patch = JSON.stringify({
        [SUBMISSION_METADATA_KEYS.lastAttemptOutcome]:
          SUBMISSION_ATTEMPT_OUTCOMES.deleting,
      });
      const [locked] = await tx
        .update(certificationSubmissions)
        .set({
          lockedAt,
          metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(certificationSubmissions.id, draft.id),
            eq(certificationSubmissions.organizationId, ctx.organizationId),
            eq(certificationSubmissions.status, DRAFT_LEDGER_STATUS),
          ),
        )
        .returning({ id: certificationSubmissions.id });
      if (!locked) throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
      lockedSubmission = {
        id: draft.id,
        lockedAt,
        priorAttemptOutcome:
          typeof priorOutcome === "string" ? priorOutcome : null,
      };
    }

    const submissionIds = rows.map((row) => row.id);
    const biocharApplications =
      submissionIds.length === 0
        ? []
        : await tx
            .select({
              registrationId: certifierBiocharApplications.id,
              externalApplicationId:
                certifierBiocharApplications.externalApplicationId,
              supplierReference: certifierBiocharApplications.supplierReference,
            })
            .from(certifierBiocharApplications)
            .where(
              and(
                inArray(
                  certifierBiocharApplications.removalSubmissionId,
                  submissionIds,
                ),
                eq(
                  certifierBiocharApplications.organizationId,
                  ctx.organizationId,
                ),
                ne(
                  certifierBiocharApplications.lifecycleStatus,
                  DELETED_REGISTRATION_STATUS,
                ),
              ),
            );

    return {
      removalId,
      facilityId,
      submissionIds,
      lockedSubmission,
      externalRemovalIds: [
        ...new Set(
          rows.flatMap((row) => (row.externalId ? [row.externalId] : [])),
        ),
      ],
      biocharApplications,
    };
  });
}

// Registry cleanup failed: reopen the draft exactly as the claim found it so
// the next submit or delete attempt sees the same interrupted state.
export async function releaseRemovalDeletionClaim(
  ctx: OrgContext,
  claim: RemovalDeletionClaim,
): Promise<void> {
  requireOrgScope(ctx);
  const locked = claim.lockedSubmission;
  if (!locked) return;
  const restore =
    locked.priorAttemptOutcome === null
      ? sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text`
      : sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify({ [SUBMISSION_METADATA_KEYS.lastAttemptOutcome]: locked.priorAttemptOutcome })}::jsonb`;
  await db
    .update(certificationSubmissions)
    .set({ lockedAt: null, metadata: restore, updatedAt: sql`now()` })
    .where(
      and(
        eq(certificationSubmissions.id, locked.id),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
        eq(certificationSubmissions.lockedAt, locked.lockedAt),
      ),
    );
}

/**
 * The claim transaction's locks are gone once it commits. When the claim
 * re-locked a draft ledger row, the `deleting` outcome keeps a concurrent
 * submit out for the lock TTL; without one (no ledger, or only rejected rows)
 * nothing does. Either way the ledger is re-read here under the row and
 * artifact locks: any row the claim did not see, any finalized status, or a
 * lock that is not ours means a submit ran in between and the Removal must
 * stay.
 */
async function assertLedgerUnchangedSinceClaim(
  ctx: OrgContext,
  tx: Tx,
  claim: RemovalDeletionClaim,
): Promise<void> {
  const rows = await tx
    .select({
      id: certificationSubmissions.id,
      status: certificationSubmissions.status,
      lockedAt: certificationSubmissions.lockedAt,
    })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, ISOMETRIC_PROVIDER),
        eq(certificationSubmissions.submissionType, REMOVAL_ENTITY_TYPE),
        eq(certificationSubmissions.localEntityType, REMOVAL_ENTITY_TYPE),
        eq(certificationSubmissions.localEntityId, claim.removalId),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    );
  const claimed = new Set(claim.submissionIds);
  if (
    rows.length !== claimed.size ||
    rows.some((row) => !claimed.has(row.id))
  ) {
    throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
  }
  if (
    rows.some((row) =>
      (FINALIZED_SUBMISSION_STATUSES as readonly string[]).includes(row.status),
    )
  ) {
    throw new SafeError(REMOVAL_DELETE_SUBMITTED_ERROR);
  }
  const locked = claim.lockedSubmission;
  for (const row of rows) {
    if (row.status !== DRAFT_LEDGER_STATUS) continue;
    const ours =
      locked !== null &&
      row.lockedAt?.getTime() === locked.lockedAt.getTime();
    if (!ours) throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
  }
}

export async function finalizeRemovalDeletion(
  ctx: OrgContext,
  claim: RemovalDeletionClaim,
  registry: RemovalDeletionRegistryOutcome,
): Promise<{ releasedSliceCount: number }> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    await lockRemovalRow(ctx, tx, claim.facilityId, claim.removalId);
    await acquireCertificationArtifactLocksSorted(tx, [
      {
        provider: ISOMETRIC_PROVIDER,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityId: claim.removalId,
      },
    ]);

    await assertLedgerUnchangedSinceClaim(ctx, tx, claim);

    if (claim.submissionIds.length > 0) {
      // Registration rows go, not just their status: the supplier reference
      // is keyed on Application, credit batch, and submission version, so a
      // retained row would collide with the same slice grouped into a new
      // Removal. The ledger row's deletion record keeps the registry IDs.
      await tx
        .delete(certifierBiocharApplications)
        .where(
          and(
            inArray(
              certifierBiocharApplications.removalSubmissionId,
              claim.submissionIds,
            ),
            eq(certifierBiocharApplications.organizationId, ctx.organizationId),
          ),
        );

      // Ledger rows stay as history: the external IDs they carry are the audit
      // trail for the registry records this deletion removed.
      const deletionPatch = JSON.stringify({
        [DELETION_METADATA_KEY]: {
          deletedAt: new Date().toISOString(),
          deletedGhgEntryIds: registry.deletedGhgEntryIds,
          deletedBiocharApplicationIds: registry.deletedBiocharApplicationIds,
        },
      });
      await tx
        .update(certificationSubmissions)
        .set({
          status: DELETED_LEDGER_STATUS,
          lockedAt: null,
          metadata: sql`(coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastError}::text - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text - ${SUBMISSION_METADATA_KEYS.externalMutation}::text) || ${deletionPatch}::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(certificationSubmissions.id, claim.submissionIds),
            eq(certificationSubmissions.organizationId, ctx.organizationId),
          ),
        );

      await tx
        .update(creditBatches)
        .set({
          productionEmissionsClaimReservedBySubmissionId: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(
              creditBatches.productionEmissionsClaimReservedBySubmissionId,
              claim.submissionIds,
            ),
            eq(creditBatches.organizationId, ctx.organizationId),
          ),
        );
    }

    await tx
      .update(creditBatches)
      .set({
        productionEmissionsClaimedByRemovalId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(creditBatches.productionEmissionsClaimedByRemovalId, claim.removalId),
          eq(creditBatches.organizationId, ctx.organizationId),
        ),
      );

    const released = await tx
      .update(creditBatchApplications)
      .set({ removalId: null })
      .where(
        and(
          eq(creditBatchApplications.removalId, claim.removalId),
          eq(creditBatchApplications.organizationId, ctx.organizationId),
        ),
      )
      .returning({ id: creditBatchApplications.id });

    const [deleted] = await tx
      .delete(certifierRemovals)
      .where(
        and(
          eq(certifierRemovals.id, claim.removalId),
          eq(certifierRemovals.facilityId, claim.facilityId),
          eq(certifierRemovals.organizationId, ctx.organizationId),
        ),
      )
      .returning({ id: certifierRemovals.id });
    if (!deleted) throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);

    logger.info(
      {
        removalId: claim.removalId,
        submissionCount: claim.submissionIds.length,
        deletedGhgEntryCount: registry.deletedGhgEntryIds.length,
        deletedBiocharApplicationCount:
          registry.deletedBiocharApplicationIds.length,
        releasedSliceCount: released.length,
      },
      "certifier removal deleted",
    );
    return { releasedSliceCount: released.length };
  });
}
