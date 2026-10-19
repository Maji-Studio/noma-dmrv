/**
 * The lock order every lab Sample writer shares, and the checks that read the
 * locked credit batch (Phase 5a, plan review items 1 and 4):
 *
 * 1. Certification artifacts: the union of every lineage the write touches
 *    (the Sample's own, the target batch on a create or move), one sorted pass.
 * 2. Credit batch rows `FOR UPDATE`, sorted by id. Membership writers lock the
 *    batch before its samples, and the sample's batch FK is checked on write.
 * 3. The Sample row `FOR UPDATE`.
 * 4. Lineage re-resolved against the artifacts held. A Removal assigned while
 *    this writer waited refuses the write; its artifact is never locked late.
 *
 * Batch existence, archive state, facility, window and zone are all read after
 * step 2, so a batch archive, delete or window edit either finished first and
 * is seen, or waits for this write. Every read goes through `tx`: a global
 * `db` read inside a runner transaction waits on itself at pool size 1.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatches, facilities, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatFacilityDate } from "@/lib/date-utils";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { hasLocalEventInstant, resolveEventInstant } from "@/lib/operations/event-times";
import {
  sampleBeforeBatchWindowError,
  sampleCreditBatchArchived,
  sampleCreditBatchNotFound,
  sampleFacilityZoneMissingError,
} from "@/lib/sample-domain-errors";
import type { EventInstant } from "@/schemas/event-instant";
import {
  assertLockedLineagesAllowMutation,
  lockCertifiedLineageArtifacts,
  type CertifiedLineageCheck,
} from "../certification-lineage-guards";
import { staleRowVersion } from "../row-version";
import { requireOrgScope } from "../utils";

export type LockedSampleRow = typeof samples.$inferSelect;

export interface LockedSampleBatch {
  id: string;
  code: string;
  facilityId: string;
  startDate: string;
  endDate: string;
  sampling: (typeof creditBatches.$inferSelect)["sampling"];
  archivedAt: Date | null;
}

export interface SampleWriteScope {
  batches: ReadonlyMap<string, LockedSampleBatch>;
  /** The locked Sample on an update or delete; undefined when it is gone. */
  sample?: LockedSampleRow;
}

/** The batch's facility as a Sample write needs it: the zone and the declared tier. */
export interface SampleBatchFacility {
  timeZone: string | null;
  durabilityOption: "200_year" | "1000_year" | null;
}

/** Lineage refusals are `certification_locked` across the runner boundary; the copy is unchanged. */
function asCertificationLocked<T>(work: () => Promise<T>): Promise<T> {
  return withFeedstockErrors(work, "certification_locked");
}

/** Steps 1 to 4 above. `creditBatchIds` may hold omitted update targets and repeats. */
export async function lockSampleWriteScope(
  ctx: OrgContext,
  tx: DbTransaction,
  args: { lineage: CertifiedLineageCheck[]; creditBatchIds: (string | undefined)[]; sampleId?: string },
): Promise<SampleWriteScope> {
  requireOrgScope(ctx);
  const lockedKeys = await asCertificationLocked(() => lockCertifiedLineageArtifacts(ctx, tx, args.lineage.map((check) => check.target)));
  const batchIds = [...new Set(args.creditBatchIds.filter((id): id is string => !!id))].sort();
  const batchRows = batchIds.length === 0 ? [] : await tx
    .select({
      id: creditBatches.id, code: creditBatches.code, facilityId: creditBatches.facilityId,
      startDate: creditBatches.startDate, endDate: creditBatches.endDate,
      sampling: creditBatches.sampling, archivedAt: creditBatches.archivedAt,
    })
    .from(creditBatches)
    .where(and(inArray(creditBatches.id, batchIds), eq(creditBatches.organizationId, ctx.organizationId)))
    .orderBy(creditBatches.id)
    .for("update");
  const [sample] = args.sampleId === undefined ? [] : await tx
    .select()
    .from(samples)
    .where(and(eq(samples.id, args.sampleId), eq(samples.organizationId, ctx.organizationId)))
    .for("update");
  await asCertificationLocked(() => assertLockedLineagesAllowMutation(ctx, tx, lockedKeys, args.lineage));
  return { batches: new Map(batchRows.map((batch) => [batch.id, batch])), sample };
}

/** A locked batch a Sample may be written onto: present in the organization and not archived (round 7 Q56). */
export function requireWritableBatch(scope: SampleWriteScope, creditBatchId: string): LockedSampleBatch {
  const batch = scope.batches.get(creditBatchId);
  if (!batch) throw sampleCreditBatchNotFound();
  if (batch.archivedAt) throw sampleCreditBatchArchived(batch.code);
  return batch;
}

export async function readSampleBatchFacility(ctx: OrgContext, tx: DbTransaction, batch: LockedSampleBatch): Promise<SampleBatchFacility> {
  requireOrgScope(ctx);
  const [facility] = await tx
    .select({ timeZone: facilities.timezone, durabilityOption: facilities.durabilityOption })
    .from(facilities)
    .where(and(eq(facilities.id, batch.facilityId), eq(facilities.organizationId, ctx.organizationId)));
  return { timeZone: facility?.timeZone ?? null, durabilityOption: facility?.durabilityOption ?? null };
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The zone the batch's sampling calendar runs on; a missing or unknown zone refuses, never falls back to UTC. */
export function requireBatchTimeZone(batch: LockedSampleBatch, facility: SampleBatchFacility): string {
  const timeZone = facility.timeZone?.trim();
  if (!timeZone || !isKnownTimeZone(timeZone)) throw sampleFacilityZoneMissingError(batch.code);
  return timeZone;
}

/**
 * Resolves `samplingTime` in the locked batch facility's zone and refuses a
 * sampling day before the batch's production window (on the same calendar).
 * Sampling after the window stays allowed; submission warns on it.
 */
export function resolveSamplingTimeForBatch(value: EventInstant, batch: LockedSampleBatch, facility: SampleBatchFacility): Date {
  const timeZone = requireBatchTimeZone(batch, facility);
  const samplingTime = resolveEventInstant(value, hasLocalEventInstant(value) ? timeZone : undefined, ["samplingTime"]);
  const samplingDay = formatFacilityDate(samplingTime, timeZone);
  if (samplingDay < batch.startDate) throw sampleBeforeBatchWindowError(samplingDay, batch);
  return samplingTime;
}

/** The credit batch an existing Sample characterises. */
export interface SampleLinks {
  creditBatchId: string;
}

/** Unlocked read of the Sample's batch, to lock before locking the Sample. */
export async function readSampleLinks(ctx: OrgContext, tx: DbTransaction, sampleId: string): Promise<SampleLinks | undefined> {
  requireOrgScope(ctx);
  const [link] = await tx.select({ creditBatchId: samples.creditBatchId }).from(samples)
    .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)));
  return link;
}

/**
 * After the locks: the locked Sample still has the batch link that was read.
 * Every caller locks that batch before the Sample; a changed link is a stale
 * version, refused rather than locked late.
 */
export function assertSampleLinksHeld(scope: SampleWriteScope, sampleId: string, read: SampleLinks): void {
  const locked = scope.sample;
  if (!locked) return;
  if (locked.creditBatchId !== read.creditBatchId) throw staleRowVersion("sample", sampleId);
}

/**
 * For a child write under a Sample (a transport leg): the Sample's full lock
 * scope (its artifacts, every batch its lineage reaches, then the Sample) and
 * the lineage re-checked under those locks, so a Removal assigned while the
 * child waited refuses it, and a concurrent Sample delete either finished
 * first (the Sample is gone) or waits for the child.
 */
export async function lockSampleParent(
  ctx: OrgContext,
  tx: DbTransaction,
  sampleId: string,
  lineage: Omit<CertifiedLineageCheck, "target">,
): Promise<LockedSampleRow | undefined> {
  requireOrgScope(ctx);
  const links = await readSampleLinks(ctx, tx, sampleId);
  if (!links) return undefined;
  const scope = await lockSampleWriteScope(ctx, tx, {
    lineage: [{ ...lineage, target: { entityType: "sample", entityId: sampleId } }],
    creditBatchIds: [links.creditBatchId],
    sampleId,
  });
  assertSampleLinksHeld(scope, sampleId, links);
  return scope.sample;
}
