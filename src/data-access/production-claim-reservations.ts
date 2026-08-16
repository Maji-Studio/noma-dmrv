import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certificationSubmissions,
  creditBatches,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  getMetadataValue,
  SUBMISSION_EXTERNAL_MUTATIONS,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { requireOrgScope } from "./utils";

type SubmissionRow = Pick<
  typeof certificationSubmissions.$inferSelect,
  | "id"
  | "provider"
  | "submissionType"
  | "localEntityType"
  | "localEntityId"
  | "status"
  | "lockedAt"
  | "metadata"
>;

function hasPossibleExternalMutation(row: SubmissionRow): boolean {
  const mutation = getMetadataValue(
    row.metadata,
    SUBMISSION_METADATA_KEYS.externalMutation,
  );
  return mutation === SUBMISSION_EXTERNAL_MUTATIONS.possible ||
    mutation === SUBMISSION_EXTERNAL_MUTATIONS.confirmed;
}

function canTransferReservation(
  row: SubmissionRow | undefined,
  nowMs: number,
): boolean {
  if (!row) return false;
  if (
    row.provider !== "isometric" ||
    row.submissionType !== "removal" ||
    row.localEntityType !== "removal"
  ) {
    return false;
  }
  if (hasPossibleExternalMutation(row)) return false;
  if (row.status === "rejected" || row.status === "superseded") return true;
  if (row.status !== "draft") return false;
  const lockedAtMs = row.lockedAt?.getTime() ?? 0;
  return nowMs - lockedAtMs >= LOCK_TTL_MS;
}

/**
 * Atomically reserves every unclaimed batch before the first registry write.
 * The exact submission may resume its own reservation. A different submission
 * can take over only when the prior ledger attempt is definitively mutation-
 * free and no longer protected by the shared submission-lock TTL.
 */
export async function reserveProductionEmissionsClaims(
  ctx: OrgContext,
  args: {
    removalId: string;
    submissionId: string;
    creditBatchIds: string[];
    now?: Date;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const ids = [...new Set(args.creditBatchIds)].sort();
  if (ids.length === 0) return;

  await db.transaction(async (tx) => {
    const batches = await tx
      .select({
        id: creditBatches.id,
        claimedByRemovalId:
          creditBatches.productionEmissionsClaimedByRemovalId,
        reservedBySubmissionId:
          creditBatches.productionEmissionsClaimReservedBySubmissionId,
      })
      .from(creditBatches)
      .where(
        and(
          inArray(creditBatches.id, ids),
          eq(creditBatches.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(creditBatches.id)
      .for("update");
    if (batches.length !== ids.length) {
      throw new SafeError(
        "A credit batch changed while reserving production inputs. Reload and retry.",
      );
    }

    const submissionIds = [
      ...new Set(
        [
          args.submissionId,
          ...batches.flatMap((batch) =>
            batch.reservedBySubmissionId
              ? [batch.reservedBySubmissionId]
              : [],
          ),
        ],
      ),
    ];
    const ownerRows = submissionIds.length > 0
      ? await tx
          .select({
            id: certificationSubmissions.id,
            provider: certificationSubmissions.provider,
            submissionType: certificationSubmissions.submissionType,
            localEntityType: certificationSubmissions.localEntityType,
            localEntityId: certificationSubmissions.localEntityId,
            status: certificationSubmissions.status,
            lockedAt: certificationSubmissions.lockedAt,
            metadata: certificationSubmissions.metadata,
          })
          .from(certificationSubmissions)
          .where(
            and(
              inArray(certificationSubmissions.id, submissionIds),
              eq(certificationSubmissions.organizationId, ctx.organizationId),
            ),
          )
      : [];
    const ownerById = new Map(ownerRows.map((row) => [row.id, row]));
    const current = ownerById.get(args.submissionId);
    if (
      !current ||
      current.provider !== "isometric" ||
      current.submissionType !== "removal" ||
      current.localEntityType !== "removal" ||
      current.localEntityId !== args.removalId ||
      current.status !== "draft"
    ) {
      throw new SafeError(
        "The Removal submission changed before production inputs were reserved. Reload and retry.",
      );
    }
    const nowMs = (args.now ?? new Date()).getTime();
    const blocked = batches.filter((batch) => {
      if (
        batch.claimedByRemovalId != null &&
        batch.claimedByRemovalId !== args.removalId
      ) {
        return true;
      }
      const ownerId = batch.reservedBySubmissionId;
      return ownerId != null &&
        ownerId !== args.submissionId &&
        !canTransferReservation(ownerById.get(ownerId), nowMs);
    });
    if (blocked.length > 0) {
      throw new SafeError(
        "Another Removal is already sending production inputs for this credit batch. Wait for it to finish or reconcile its interrupted submission.",
      );
    }

    const reserved = await tx
      .update(creditBatches)
      .set({
        productionEmissionsClaimReservedBySubmissionId: args.submissionId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(creditBatches.id, ids),
          eq(creditBatches.organizationId, ctx.organizationId),
        ),
      )
      .returning({ id: creditBatches.id });
    if (reserved.length !== ids.length) {
      throw new SafeError(
        "Production-input reservation changed while submitting. Reload and retry.",
      );
    }
  });
}

/** Definitive, mutation-free failure releases the reservation with rejection. */
export async function rejectSubmissionAndReleaseProductionClaims(
  ctx: OrgContext,
  args: {
    submissionId: string;
    expectedLockedAt: Date;
    errorMessage: string;
  },
): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async (tx) => {
    const [submission] = await tx
      .select({
        id: certificationSubmissions.id,
        provider: certificationSubmissions.provider,
        submissionType: certificationSubmissions.submissionType,
        localEntityType: certificationSubmissions.localEntityType,
        localEntityId: certificationSubmissions.localEntityId,
        status: certificationSubmissions.status,
        lockedAt: certificationSubmissions.lockedAt,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.id, args.submissionId),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      )
      .for("update");
    if (!submission || hasPossibleExternalMutation(submission)) return;

    const exactDraftAttempt =
      submission.status === "draft" &&
      submission.lockedAt?.getTime() === args.expectedLockedAt.getTime();
    const alreadyDefinitive =
      submission.status === "rejected" || submission.status === "superseded";
    if (!exactDraftAttempt && !alreadyDefinitive) return;

    if (exactDraftAttempt) {
      await tx
        .update(certificationSubmissions)
        .set({
          status: "rejected",
          lockedAt: null,
          updatedAt: sql`now()`,
          metadata: sql`(coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text - ${SUBMISSION_METADATA_KEYS.externalMutation}::text) || jsonb_build_object(${SUBMISSION_METADATA_KEYS.lastError}::text, ${args.errorMessage}::text)`,
        })
        .where(
          and(
            eq(certificationSubmissions.id, args.submissionId),
            eq(certificationSubmissions.status, "draft"),
            eq(certificationSubmissions.lockedAt, args.expectedLockedAt),
            eq(certificationSubmissions.organizationId, ctx.organizationId),
          ),
        );
    }
    await tx
      .update(creditBatches)
      .set({
        productionEmissionsClaimReservedBySubmissionId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(
            creditBatches.productionEmissionsClaimReservedBySubmissionId,
            args.submissionId,
          ),
          eq(creditBatches.organizationId, ctx.organizationId),
        ),
      );
  });
}
