import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { sampleNotFound } from "@/lib/sample-domain-errors";
import { retireDocumentsForEntities } from "../documents";
import { assertRowVersion } from "../row-version";
import { deleteTransportLegsForEntity } from "../transport-legs";
import { requireOrgScope } from "../utils";
import { assertSampleLinksHeld, lockSampleWriteScope, readSampleLinks } from "./write-scope";

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
): Promise<void> {
  requireOrgScope(ctx);
  const links = await readSampleLinks(ctx, tx, sampleId);
  if (!links) throw sampleNotFound();
  const scope = await lockSampleWriteScope(ctx, tx, {
    lineage: [{ target: { entityType: "sample", entityId: sampleId }, mutation: "delete" }],
    creditBatchIds: links.lineageBatchIds,
    sampleId,
  });
  if (!scope.sample) throw sampleNotFound();
  assertRowVersion({ entity: "sample", id: sampleId, expectedVersion, actualVersion: scope.sample.version });
  await assertSampleLinksHeld(ctx, tx, scope, sampleId, links);

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
}
