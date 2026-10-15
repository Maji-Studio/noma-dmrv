import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatches, facilities, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { sampleNotFound } from "@/lib/sample-domain-errors";
import { retireDocumentsForEntities } from "../documents";
import { assertRowVersion, staleRowVersion } from "../row-version";
import { deleteTransportLegsForEntity } from "../transport-legs";
import { requireOrgScope } from "../utils";
import { assertSampleLinksHeld, lockSampleWriteScope, readSampleLinks } from "./write-scope";

/** Only org-scoped links survive deletion for the operation's activity record. */
export interface DeletedSampleLinks {
  id: string;
  creditBatchId: string;
  productionRunId: string | null;
  facilityId: string | undefined;
}

/**
 * KEY SHARE on the batch's facility before the batch lock. The activity
 * event's facility FK takes this lock anyway, but only at the end, after the
 * batch lock; a facility archive takes the facility FOR UPDATE and then the
 * batch, so taking it late deadlocks against the archive. Returns the facility
 * locked, or undefined when the batch is gone.
 */
async function lockSampleFacilityKey(ctx: OrgContext, tx: DbTransaction, creditBatchId: string): Promise<string | undefined> {
  requireOrgScope(ctx);
  const [facility] = await tx.select({ id: facilities.id }).from(creditBatches)
    .innerJoin(facilities, and(eq(facilities.id, creditBatches.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatches.id, creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .for("key share", { of: facilities });
  return facility?.id;
}

/**
 * Delete a lab Sample inside the caller's transaction: its transport legs go
 * with it, and its documents (the lab report) and the legs' documents are
 * retired. Retirement only queues the storage deletions; the caller drains
 * them after commit, never inside a dry run. Allowed on an archived batch:
 * removing a wrong record is not a write onto that batch.
 */
export async function deleteSampleInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  sampleId: string,
  expectedVersion: number,
): Promise<DeletedSampleLinks> {
  requireOrgScope(ctx);
  const links = await readSampleLinks(ctx, tx, sampleId);
  if (!links) throw sampleNotFound();
  const lockedFacilityId = await lockSampleFacilityKey(ctx, tx, links.creditBatchId);
  const scope = await lockSampleWriteScope(ctx, tx, {
    lineage: [{ target: { entityType: "sample", entityId: sampleId }, mutation: "delete" }],
    creditBatchIds: [links.creditBatchId],
    sampleId,
  });
  if (!scope.sample) throw sampleNotFound();
  assertRowVersion({ entity: "sample", id: sampleId, expectedVersion, actualVersion: scope.sample.version });
  assertSampleLinksHeld(scope, sampleId, links);
  const facilityId = scope.batches.get(scope.sample.creditBatchId)?.facilityId;
  // A batch moved to another facility while this waited: refuse rather than lock that facility late.
  if (facilityId !== lockedFacilityId) throw staleRowVersion("sample", sampleId);

  const transportLegDocuments = await deleteTransportLegsForEntity(ctx, tx, "sample", sampleId);
  const deleted = await tx
    .delete(samples)
    .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)))
    .returning({ id: samples.id });
  if (deleted.length === 0) throw sampleNotFound();
  await retireDocumentsForEntities(ctx, tx, [
    { entityType: "sample", entityId: sampleId },
    ...transportLegDocuments,
  ]);
  return {
    id: sampleId, creditBatchId: scope.sample.creditBatchId, productionRunId: scope.sample.productionRunId,
    facilityId,
  };
}
