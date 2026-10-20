import { releaseSubmissionReservations } from "./submission-reservation-release";
import { recordActivityChange } from "./activity-events";
import { emissionEntries } from "@/db/schema/emission-entries";
import { readRemovalEntrySnapshot } from "@/lib/certification/removal-entry-snapshot";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions } from "@/db/schema/certification";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import { pluralize } from "@/lib/copy-utils";
import { requireOrgScope } from "./utils";
import { nextVersion } from "./row-version";
import { withCertificationStatusActivity, type CertificationActivityOrigin } from "./certification-status-activity";
import { rejectDraftSubmission } from "./submission-rejection";
import type { Tx } from "./certification";

export async function markSubmissionSubmitted(
  ctx: OrgContext,
  id: string,
  args: {
    externalId: string;
    supersedePreviousId?: string | null;
    expectedLockedAt?: Date;
    // §8.6.2: atomically stamp the claiming removal onto its member batches.
    // Optional because GHG-statement callers do not claim.
    productionEmissionsClaim?: { removalId: string; creditBatchIds: string[] };
  },
  callerTx?: Tx,
  origin?: CertificationActivityOrigin,
): Promise<void> {
  requireOrgScope(ctx);
  const run = async (tx: Tx): Promise<void> => {
    const updated = await tx
      .update(certificationSubmissions)
      .set({
        status: "submitted",
        externalId: args.externalId,
        submittedAt: sql`now()`,
        lockedAt: null,
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastError}::text - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text - ${SUBMISSION_METADATA_KEYS.externalMutation}::text`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(certificationSubmissions.id, id),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
          ...(args.expectedLockedAt
            ? [eq(certificationSubmissions.status, "draft" as const), eq(certificationSubmissions.lockedAt, args.expectedLockedAt)]
            : []),
        ),
      )
      .returning({ id: certificationSubmissions.id, payloadSnapshot: certificationSubmissions.payloadSnapshot });
    if (updated.length === 0) {
      throw new SafeError("The submission changed before it could be finalized. Refresh and try again.");
    }
    if (args.supersedePreviousId) {
      await tx
        .update(certificationSubmissions)
        .set({
          status: "superseded",
          supersededAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(certificationSubmissions.id, args.supersedePreviousId), eq(certificationSubmissions.organizationId, ctx.organizationId)));
    }
    // Not flag-gated: entries reserved while the flag was on must still be stamped.
    if (args.productionEmissionsClaim) {
      // Match reservation/value writers: all member batches in id order, then entries.
      const members = await tx.select({ creditBatchId: creditBatchApplications.creditBatchId }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId),
          eq(creditBatchApplications.removalId, args.productionEmissionsClaim.removalId)));
      const reserved = await tx.select({ creditBatchId: emissionEntries.creditBatchId }).from(emissionEntries)
        .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.sendReservedBySubmissionId, id)));
      const batchIds = [...new Set([...args.productionEmissionsClaim.creditBatchIds, ...members.map((row) => row.creditBatchId), ...reserved.map((row) => row.creditBatchId)])];
      if (batchIds.length) await tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(and(eq(creditBatches.organizationId, ctx.organizationId), inArray(creditBatches.id, batchIds)))
        .orderBy(creditBatches.id).for("update");
      const frozen = readRemovalEntrySnapshot(updated[0]).frozenEntrySet;
      const beforeEntries = await tx.select().from(emissionEntries).where(and(
        eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.sendReservedBySubmissionId, id),
      )).orderBy(emissionEntries.id).for("update");
      const stamped = await tx.update(emissionEntries).set({
        sentByRemovalId: args.productionEmissionsClaim.removalId, sendReservedBySubmissionId: null,
        version: nextVersion(emissionEntries.version), updatedAt: sql`now()`,
      }).where(and(eq(emissionEntries.organizationId, ctx.organizationId),
        eq(emissionEntries.sendReservedBySubmissionId, id), isNull(emissionEntries.deletedAt),
        or(isNull(emissionEntries.sentByRemovalId), eq(emissionEntries.sentByRemovalId, args.productionEmissionsClaim.removalId)),
      )).returning();
      if (stamped.length !== frozen.length || stamped.some((entry) => !frozen.some((item) => item.entryId === entry.id && item.contentRevision === entry.contentRevision))) {
        throw new SafeError("Emissions entry reservation changed before submission could be finalized. Review the Removal again.");
      }
      for (const entry of stamped) await recordActivityChange(ctx, tx, {
        entityType: "emission_entry", entityId: entry.id, creditBatchId: entry.creditBatchId, action: "updated", source: "form",
      }, beforeEntries.find((before) => before.id === entry.id)!, entry, { skipEmpty: true });
    }
    if (args.productionEmissionsClaim?.creditBatchIds.length) {
      // A throw here rolls back the ledger flip too: the row stays a locked
      // draft, the resume path reconciles the already-POSTed registry
      // artifacts by supplier ref, and the pre-flight claim gate re-fires
      // loudly on retry.
      await stampProductionEmissionsClaimWithExecutor(
        ctx,
        tx,
        { ...args.productionEmissionsClaim, reservationSubmissionId: id },
      );
    }
  };
  await withCertificationStatusActivity(ctx, [id, ...(args.supersedePreviousId ? [args.supersedePreviousId] : [])], run, callerTx, origin);
}

// §8.6.2 claim stamp (issue #349, ADR 0020). Guarded UPDATE (IS NULL OR =
// self): unclaimed rows and self re-claims (resubmit/supersede) are stamped;
// a foreign claim or transferred reservation is excluded by the predicates.
// The rowcount backstop turns either exclusion into a loud failure and rolls
// back the ledger transition with the claim write.
async function stampProductionEmissionsClaimWithExecutor(
  ctx: OrgContext,
  executor: Tx | typeof db,
  args: {
    removalId: string;
    creditBatchIds: string[];
    reservationSubmissionId: string;
  },
): Promise<void> {
  const { removalId, creditBatchIds } = args;
  const stamped = await executor
    .update(creditBatches)
    .set({ version: nextVersion(creditBatches.version),
      productionEmissionsClaimedByRemovalId: removalId,
      productionEmissionsClaimReservedBySubmissionId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(creditBatches.id, creditBatchIds),
        or(
          isNull(creditBatches.productionEmissionsClaimedByRemovalId),
          eq(creditBatches.productionEmissionsClaimedByRemovalId, removalId),
        ),
        eq(
          creditBatches.productionEmissionsClaimReservedBySubmissionId,
          args.reservationSubmissionId,
        ),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: creditBatches.id });
  if (stamped.length !== creditBatchIds.length) {
    const stampedIds = new Set(stamped.map((row) => row.id));
    const skipped = creditBatchIds.filter((id) => !stampedIds.has(id));
    throw new SafeError(
      `${skipped.length} credit ${pluralize(skipped.length, "batch", "batches")} ${skipped.length === 1 ? "was" : "were"} claimed by another Removal while this submission was running (§8.6.2). Reload and submit again.`,
    );
  }
}

// Retires a claimed draft this deploy refuses to resume (currently: its
// snapshot predates the live INPUT_MAPPING revision — see
// production-claim-gate.ts). `superseded` is terminal and NON-blocking, so
// the next submit attempt mints a fresh version from live data; `rejected`
// would route straight back to resume on an unchanged hash and loop forever.
// Status-guarded to drafts — never retires a row that progressed.
export async function retireStaleSubmissionDraft(
  ctx: OrgContext,
  id: string,
  args: { reason: string },
): Promise<void> {
  requireOrgScope(ctx);
  await withCertificationStatusActivity(ctx, [id], async (tx) => {
    const [retired] = await tx
      .update(certificationSubmissions)
      .set({
        status: "superseded",
        supersededAt: sql`now()`,
        lockedAt: null,
        updatedAt: sql`now()`,
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object('retiredReason', ${args.reason}::text)`,
      })
      .where(
        and(
          eq(certificationSubmissions.id, id),
          eq(certificationSubmissions.status, "draft"),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      ).returning({ removalId: certificationSubmissions.localEntityId });
    if (retired) await releaseSubmissionReservations(ctx, tx, id, retired.removalId);
  });
}

export async function markSubmissionRejected(
  ctx: OrgContext,
  id: string,
  args: { errorMessage: string; expectedLockedAt?: Date },
): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction((tx) => rejectDraftSubmission(ctx, tx, id, args));
}

// Deep-merges recovery facts into payload_snapshot.journaled so successive
// measurement-sample steps retain previously recorded registry identities.
export async function appendSubmissionJournal(
  ctx: OrgContext,
  id: string,
  patch: Record<string, unknown>,
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  await (tx ?? db)
    .update(certificationSubmissions)
    .set({
      payloadSnapshot: sql`jsonb_set(
        coalesce(${certificationSubmissions.payloadSnapshot}, '{}'::jsonb),
        '{journaled}',
        coalesce(${certificationSubmissions.payloadSnapshot} -> 'journaled', '{}'::jsonb)
          || ${JSON.stringify(patch)}::jsonb,
        true
      )`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
}

export async function updateSubmissionMetadata(
  ctx: OrgContext,
  id: string,
  patch: Record<string, unknown>,
  tx?: Tx,
  origin?: CertificationActivityOrigin,
): Promise<void> {
  requireOrgScope(ctx);
  await withCertificationStatusActivity(ctx, [id], async (executor) => {
    await executor
      .update(certificationSubmissions)
      .set({
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
  }, tx, origin);
}

export async function setSubmissionTerminalStatus(
  ctx: OrgContext,
  id: string,
  args: {
    status: "accepted" | "rejected";
    metadataPatch?: Record<string, unknown>;
  },
  tx?: Tx,
  origin?: CertificationActivityOrigin,
): Promise<void> {
  requireOrgScope(ctx);
  await withCertificationStatusActivity(ctx, [id], async (executor) => {
    await executor
      .update(certificationSubmissions)
      .set({
        status: args.status,
        lockedAt: null,
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
  }, tx, origin);
}

export async function clearTerminalStatusForResubmit(
  ctx: OrgContext,
  id: string,
  args: { metadataPatch?: Record<string, unknown> } = {},
  tx?: Tx,
  origin?: CertificationActivityOrigin,
): Promise<void> {
  requireOrgScope(ctx);
  await withCertificationStatusActivity(ctx, [id], async (executor) => {
    await executor
      .update(certificationSubmissions)
      .set({
        status: "submitted",
        lockedAt: null,
        metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)));
  }, tx, origin);
}

