import { REMOVAL_DELETION_LEASE_KEY, hasFreshRemovalDeletionLease, removalDeletionLeaseTimestamp } from "@/lib/certification/removal-deletion-lease";
import { removalOwnedMeasurements, type RemovalOwnedMeasurement } from "@/lib/certification/removal-deletion-artifacts";
import { removalProductionBatchTargets, clearDeletedRemovalProductionBatches, type RemovalProductionBatch, type ProductionBatchDeletionOutcome } from "./removal-production-batch-deletion";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, withDedicatedLockConnection } from "@/db";
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
import { LOCK_TTL_MS, isLockedInFlight } from "@/lib/isometric/utils/lock";
import { buildRemovalSupplierRef } from "@/lib/isometric/utils/supplier-ref";
import { logger } from "@/lib/log";
import { FINALIZED_SUBMISSION_STATUSES } from "./certification-submissions";
import {
  releaseDocumentUploadsReferencedOnlyBySubmissions,
  type ReleasedDocumentUpload,
} from "./certifier-document-uploads";
import { requireOrgScope } from "./utils";

/**
 * Deleting a Removal that never finalized.
 *
 * A submission that failed or was interrupted after "Creating Removal in
 * Isometric" leaves a DRAFT GHG Entry (and possibly Biochar Applications) on
 * the registry while the local ledger row stays a draft. Operators must be
 * able to remove that Removal, and the registry records must go with it.
 *
 * The flow has three seams; registry lookups stay outside database transactions:
 *   1. `claimRemovalDeletion` verifies eligibility under the Removal row lock
 *      and shared artifact lock, leases the Removal even without ledger rows,
 *      then stamps every ledger row (draft or
 *      rejected) with a fresh lock and the `deleting` attempt outcome so a
 *      concurrent submit can neither resume nor reclaim one for the lock TTL.
 *   2. Each destructive registry call holds the Removal, artifact, and batch
 *      locks on a dedicated connection after revalidating claim ownership.
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
 *
 * No role floor for now: any organization member may delete, registry
 * cleanup included (decision of 2026-09-08, tracked in issue #746).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DELETED_REGISTRATION_STATUS = "deleted" as const;
const DRAFT_LEDGER_STATUS = "draft" as const;
const DELETED_LEDGER_STATUS = "rejected" as const;
const DELETION_METADATA_KEY = SUBMISSION_METADATA_KEYS.deletion;
const REMOVAL_SUPPLIER_REF_ROLE = "removal" as const;

export const REMOVAL_DELETE_SUBMITTED_ERROR =
  "This Removal was submitted to Isometric and cannot be deleted.";
export const REMOVAL_DELETE_STATEMENT_ERROR =
  "This Removal belongs to a GHG Statement and cannot be deleted.";
export const REMOVAL_DELETE_IN_FLIGHT_ERROR =
  "A submission attempt is still running for this Removal. Wait for it to finish, then try again.";
export const REMOVAL_DELETE_ALREADY_DELETING_ERROR =
  "This Removal is already being deleted. Wait for that to finish, then refresh the page.";
const REMOVAL_DELETE_MISSING_ERROR =
  "This Removal no longer exists. Refresh the page.";
export const REMOVAL_DELETE_CHANGED_ERROR =
  "This Removal changed while it was being deleted. Refresh the page and review its status.";

export interface RemovalDeletionClaim {
  removalId: string;
  facilityId: string;
  productionBatches?: RemovalProductionBatch[];
  measurementSamples?: RemovalOwnedMeasurement[];
  /** Every ledger row for this Removal; all are draft or rejected. */
  submissionIds: string[];
  /** Ownership timestamp on the Removal lease and every ledger row. */
  lockedAt: Date;
  /** Each ledger row's prior lock and attempt outcome, restored when the claim is released. */
  lockedSubmissions: Array<{
    id: string;
    priorLockedAt: Date | null;
    priorAttemptOutcome: string | null;
  }>;
  /** Registry GHG Entry IDs recorded on the ledger rows. */
  externalRemovalIds: string[];
  /**
   * Supplier references of ledger rows that never recorded a GHG Entry ID.
   * The POST may still have landed, so the caller reconciles each against
   * the registry before deciding nothing is there to delete.
   */
  unconfirmedRemovalSupplierRefs: string[];
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
  productionBatches?: ProductionBatchDeletionOutcome[];
  measurementSamples?: Array<RemovalOwnedMeasurement & { outcome: "deleted" | "absent" }>;
  deletedGhgEntryIds: string[];
  deletedBiocharApplicationIds: string[];
  /** Records the registry reported as already gone (404), kept for the audit trail. */
  absentGhgEntryIds: string[];
  absentBiocharApplicationIds: string[];
  /**
   * Supplier references of `creating` registrations the registry did not
   * know. Their POST never landed as far as we can tell; recorded so a later
   * reconciliation onto an orphan can be traced back here.
   */
  unresolvedBiocharApplicationReferences: string[];
}

async function lockRemovalRow(
  ctx: OrgContext,
  tx: Tx,
  facilityId: string,
  removalId: string,
): Promise<{ id: string; ghgStatementId: string | null; metadata: unknown }> {
  const [removal] = await tx
    .select({
      id: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
      metadata: certifierRemovals.metadata,
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

function isDeletionInFlight(row: {
  lockedAt: Date | null;
  metadata: unknown;
}): boolean {
  return (
    row.lockedAt !== null &&
    Date.now() - row.lockedAt.getTime() < LOCK_TTL_MS &&
    getMetadataValue(row.metadata, SUBMISSION_METADATA_KEYS.lastAttemptOutcome) ===
      SUBMISSION_ATTEMPT_OUTCOMES.deleting
  );
}

export async function claimRemovalDeletion(
  ctx: OrgContext,
  facilityId: string,
  removalId: string,
): Promise<RemovalDeletionClaim> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const removal = await lockRemovalRow(ctx, tx, facilityId, removalId);
    if (hasFreshRemovalDeletionLease(removal.metadata)) {
      throw new SafeError(REMOVAL_DELETE_ALREADY_DELETING_ERROR);
    }
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
        version: certificationSubmissions.version,
        payloadSnapshot: certificationSubmissions.payloadSnapshot,
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
    // The ledger holds at most one open draft per Removal; more than one is
    // a state this claim cannot re-lock and release as a unit.
    if (drafts.length > 1) throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
    for (const draft of drafts) {
      if (
        isLockedInFlight(draft) &&
        !isSubmissionAttemptInterrupted(draft.metadata)
      ) {
        throw new SafeError(REMOVAL_DELETE_IN_FLIGHT_ERROR);
      }
    }
    // Another deletion of this Removal may be mid-cleanup: its stamp sits on
    // rejected rows too, which `isLockedInFlight` does not consider.
    if (rows.some(isDeletionInFlight)) {
      throw new SafeError(REMOVAL_DELETE_ALREADY_DELETING_ERROR);
    }

    const measurementSamples = removalOwnedMeasurements(removalId, rows);
    const productionBatches = (await removalProductionBatchTargets(ctx, removalId, tx))
      .filter((batch) => rows.length > 0 || batch.registrationId !== null);
    // Serialize with createRemoval membership decisions before publishing deleting markers.
    if (productionBatches.length) await tx.select({ id: creditBatches.id }).from(creditBatches)
      .where(and(inArray(creditBatches.id, productionBatches.map((batch) => batch.creditBatchId)), eq(creditBatches.organizationId, ctx.organizationId)))
      .orderBy(creditBatches.id).for("update");
    const submissionIds = rows.map((row) => row.id);
    const externalRemovalIds = [
      ...new Set(
        rows.flatMap((row) => (row.externalId ? [row.externalId] : [])),
      ),
    ];
    const unconfirmedRemovalSupplierRefs = rows
      .filter((row) => row.externalId === null)
      .map((row) =>
        buildRemovalSupplierRef({
          removalId,
          role: REMOVAL_SUPPLIER_REF_ROLE,
          version: row.version,
        }),
      );
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
    // Every row gets the same fresh lock, rejected ones included: the submit
    // path resumes a rejected row with an unchanged payload hash, and its
    // resume CAS refuses any row whose lock is still fresh.
    const lockedAt = new Date();
    await tx.update(certifierRemovals).set({
      metadata: sql`coalesce(${certifierRemovals.metadata}, '{}'::jsonb) || ${JSON.stringify({ [REMOVAL_DELETION_LEASE_KEY]: lockedAt.toISOString() })}::jsonb`,
    }).where(and(eq(certifierRemovals.id, removalId), eq(certifierRemovals.organizationId, ctx.organizationId)));

    const lockedSubmissions: RemovalDeletionClaim["lockedSubmissions"] = [];
    const patch = JSON.stringify({
      [SUBMISSION_METADATA_KEYS.lastAttemptOutcome]:
        SUBMISSION_ATTEMPT_OUTCOMES.deleting,
    });
    for (const row of rows) {
      const priorOutcome = getMetadataValue(
        row.metadata,
        SUBMISSION_METADATA_KEYS.lastAttemptOutcome,
      );
      const [locked] = await tx
        .update(certificationSubmissions)
        .set({
          lockedAt,
          metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(certificationSubmissions.id, row.id),
            eq(certificationSubmissions.organizationId, ctx.organizationId),
            eq(certificationSubmissions.status, row.status),
          ),
        )
        .returning({ id: certificationSubmissions.id });
      if (!locked) throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
      lockedSubmissions.push({
        id: row.id,
        // An interrupted attempt's own lock is part of its settle window; a
        // failed deletion must hand it back untouched.
        priorLockedAt: row.lockedAt,
        // A stale `deleting` marker (an expired earlier claim) is not a state
        // worth restoring.
        priorAttemptOutcome:
          typeof priorOutcome === "string" &&
          priorOutcome !== SUBMISSION_ATTEMPT_OUTCOMES.deleting
            ? priorOutcome
            : null,
      });
    }

    return {
      removalId,
      facilityId,
      submissionIds,
      lockedAt,
      lockedSubmissions,
      externalRemovalIds,
      unconfirmedRemovalSupplierRefs,
      biocharApplications,
      productionBatches,
      measurementSamples,
    };
  });
}

// Cleanup stopped: reopen every ledger row exactly as the claim found it so
// the next submit or delete attempt sees the same interrupted state. The CAS
// on our lock timestamp makes this a no-op for any row someone else re-locked.
export async function releaseRemovalDeletionClaim(
  ctx: OrgContext,
  claim: RemovalDeletionClaim,
): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async (tx) => {
    const released = await tx.update(certifierRemovals).set({
      metadata: sql`coalesce(${certifierRemovals.metadata}, '{}'::jsonb) - ${REMOVAL_DELETION_LEASE_KEY}::text`,
    }).where(and(
      eq(certifierRemovals.id, claim.removalId),
      eq(certifierRemovals.facilityId, claim.facilityId),
      eq(certifierRemovals.organizationId, ctx.organizationId),
      sql`${certifierRemovals.metadata}->>${REMOVAL_DELETION_LEASE_KEY} = ${claim.lockedAt.toISOString()}`,
    )).returning({ id: certifierRemovals.id });
    if (!released.length) return;
    for (const locked of claim.lockedSubmissions) {
      const restore =
        locked.priorAttemptOutcome === null
          ? sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text`
          : sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify({ [SUBMISSION_METADATA_KEYS.lastAttemptOutcome]: locked.priorAttemptOutcome })}::jsonb`;
      await tx
        .update(certificationSubmissions)
        .set({
          lockedAt: locked.priorLockedAt,
          metadata: restore,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(certificationSubmissions.id, locked.id),
            eq(certificationSubmissions.organizationId, ctx.organizationId),
            eq(certificationSubmissions.lockedAt, claim.lockedAt),
          ),
        );
    }
  });
}

/**
 * The claim transaction's locks are gone once it commits; the `deleting`
 * lease on the Removal blocks submission claims for the lock TTL. Once it
 * expires, another submission or deletion may claim the artifact. Ownership
 * and the ledger are therefore re-read here under the row and artifact
 * locks: any row the claim did not see, any finalized status, or a lock that
 * is not ours means a submit ran in between and the Removal must stay.
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
  for (const row of rows) {
    if (row.lockedAt?.getTime() !== claim.lockedAt.getTime()) {
      throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
    }
  }
}

export interface RemovalDeletionFinalizeResult {
  releasedSliceCount: number;
  /** Local Source mappings only the deleted submissions still referenced. */
  releasedDocumentMirrors: ReleasedDocumentUpload[];
}

/**
 * Fence one destructive registry call with the locks used by deletion,
 * submission, and membership creation. The callback uses this transaction for
 * database reads; pooled audit writes run only after this seam releases its
 * locks. Lookups stay outside; the final batch sharing check runs inside it.
 */
export async function withRemovalDeletionMutation<T>(
  ctx: OrgContext,
  claim: RemovalDeletionClaim,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedLockConnection(async (tx) => {
    const removal = await lockRemovalRow(ctx, tx, claim.facilityId, claim.removalId);
    if (removalDeletionLeaseTimestamp(removal.metadata) !== claim.lockedAt.toISOString()) {
      throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
    }
    await acquireCertificationArtifactLocksSorted(tx, [{
      provider: ISOMETRIC_PROVIDER,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityId: claim.removalId,
    }]);
    const batchIds = (claim.productionBatches ?? []).map((batch) => batch.creditBatchId);
    if (batchIds.length) {
      await tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(and(inArray(creditBatches.id, batchIds), eq(creditBatches.organizationId, ctx.organizationId)))
        .orderBy(creditBatches.id).for("update");
    }
    await assertLedgerUnchangedSinceClaim(ctx, tx, claim);
    // Exact ownership is sufficient while these locks fence takeover. Requiring
    // TTL freshness here would make a long successful lookup impossible to finish.
    return run(tx);
  });
}

export async function finalizeRemovalDeletion(
  ctx: OrgContext,
  claim: RemovalDeletionClaim,
  registry: RemovalDeletionRegistryOutcome,
): Promise<RemovalDeletionFinalizeResult> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const removal = await lockRemovalRow(ctx, tx, claim.facilityId, claim.removalId);
    if (removalDeletionLeaseTimestamp(removal.metadata) !== claim.lockedAt.toISOString()) {
      throw new SafeError(REMOVAL_DELETE_CHANGED_ERROR);
    }
    await acquireCertificationArtifactLocksSorted(tx, [
      {
        provider: ISOMETRIC_PROVIDER,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityId: claim.removalId,
      },
    ]);

    const productionBatchIds = (claim.productionBatches ?? []).map((batch) => batch.creditBatchId);
    if (productionBatchIds.length) {
      // Serialize finalizers of different Removals before checking surviving owners.
      await tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(and(inArray(creditBatches.id, productionBatchIds), eq(creditBatches.organizationId, ctx.organizationId)))
        .orderBy(creditBatches.id).for("update");
    }

    await assertLedgerUnchangedSinceClaim(ctx, tx, claim);

    let releasedDocumentMirrors: ReleasedDocumentUpload[] = [];
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

      await clearDeletedRemovalProductionBatches(ctx, claim, registry.productionBatches ?? [], tx);

      // The evidence these submissions mirrored keeps its local mapping only
      // while a live snapshot still references it; otherwise the mapping
      // would block deleting the Application or Delivery that owns the file.
      releasedDocumentMirrors =
        await releaseDocumentUploadsReferencedOnlyBySubmissions(
          ctx,
          claim.submissionIds,
          tx,
        );

      // Ledger rows stay as history: the external IDs they carry are the audit
      // trail for the registry records this deletion removed.
      const deletionPatch = JSON.stringify({
        [DELETION_METADATA_KEY]: {
          deletedAt: new Date().toISOString(),
          productionBatches: registry.productionBatches ?? [],
          measurementSamples: registry.measurementSamples ?? [],
          deletedGhgEntryIds: registry.deletedGhgEntryIds,
          deletedBiocharApplicationIds: registry.deletedBiocharApplicationIds,
          absentGhgEntryIds: registry.absentGhgEntryIds,
          absentBiocharApplicationIds: registry.absentBiocharApplicationIds,
          unresolvedBiocharApplicationReferences:
            registry.unresolvedBiocharApplicationReferences,
          releasedDocumentMirrors,
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

    if (!claim.submissionIds.length) await clearDeletedRemovalProductionBatches(ctx, claim, registry.productionBatches ?? [], tx);

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
        releasedDocumentMirrorCount: releasedDocumentMirrors.length,
      },
      "certifier removal deleted",
    );
    return { releasedSliceCount: released.length, releasedDocumentMirrors };
  });
}
