import { and, desc, eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";

/**
 * Tear down the removal the New-Removal wizard creates at "Confirm"
 * (deferred-create groups the batch into a fresh `certifier_removals` row and,
 * on a live submit, writes a `certification_submissions` row). The seed's own
 * `cleanup()` only knows the batch + chain, so the spec calls this BEFORE that
 * cleanup: it releases the batch's application slices, drops any submission
 * rows, then the Removal. A no-op when "Confirm" never ran.
 */
export async function teardownWizardRemovalForBatch(
  creditBatchId: string,
): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    const [row] = await db
      .select({ removalId: schema.creditBatchApplications.removalId })
      .from(schema.creditBatchApplications)
      .innerJoin(
        schema.certifierRemovals,
        eq(
          schema.certifierRemovals.id,
          schema.creditBatchApplications.removalId,
        ),
      )
      .where(eq(schema.creditBatchApplications.creditBatchId, creditBatchId))
      .orderBy(
        desc(schema.certifierRemovals.createdAt),
        desc(schema.certifierRemovals.id),
      );
    const removalId = row?.removalId;
    if (!removalId) return;

    await db
      .update(schema.creditBatchApplications)
      .set({ removalId: null })
      .where(
        and(
          eq(schema.creditBatchApplications.creditBatchId, creditBatchId),
          eq(schema.creditBatchApplications.removalId, removalId),
        ),
      );
    // A LIVE submit also stamps the batch's front-loaded production-emissions
    // claim (credit_batches.production_emissions_claimed_by_removal_id); the
    // removal row cannot be deleted while any batch still claims through it.
    await db
      .update(schema.creditBatches)
      .set({ productionEmissionsClaimedByRemovalId: null })
      .where(
        eq(
          schema.creditBatches.productionEmissionsClaimedByRemovalId,
          removalId,
        ),
      );
    await db
      .delete(schema.certificationSubmissions)
      .where(eq(schema.certificationSubmissions.localEntityId, removalId));
    await db
      .delete(schema.certifierRemovals)
      .where(eq(schema.certifierRemovals.id, removalId));
  } finally {
    await pool.end();
  }
}
