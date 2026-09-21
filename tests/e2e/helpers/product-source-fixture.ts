import { deleteOutputProductFixtures } from "../../helpers/output-contract-fixtures";
import { createDbConnection } from "../fixtures/db";
import { eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { biocharProducts, biocharProductSourceAllocations, productionRuns } from "@/db/schema";

/** Replace a per-test product's seed provenance with explicitly measured source facts. */
export async function setProductSourceFixture(
  tx: DbTransaction,
  productId: string,
  runId: string,
  wetKg: number,
  dryKg: number,
  placedAt: string,
) {
  const [run] = await tx.select().from(productionRuns).where(eq(productionRuns.id, runId));
  if (!run?.biocharStorageLocationId || run.biocharDryMassKg == null || run.biocharDryMassKg < dryKg) {
    throw new Error("Fixture source must establish sufficient measured dry biochar in a bin");
  }
  await tx.delete(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, productId));
  await tx.insert(biocharProductSourceAllocations).values({
    organizationId: run.organizationId, biocharProductId: productId,
    productionRunId: runId, sourceStorageLocationId: run.biocharStorageLocationId,
    allocatedWetMassKg: wetKg, allocatedDryMassKg: dryKg,
  });
  await tx.update(biocharProducts).set({
    linkedProductionRunId: runId, sourceBiocharStorageLocationId: run.biocharStorageLocationId,
    massKg: wetKg, moistureContentPercent: 0, placedAt,
  }).where(eq(biocharProducts.id, productId));
}

/** Posted products cannot be deleted through operator CRUD; fixture teardown owns the journal. */
export async function deleteProductBinFixtures(storageLocationId: string) {
  const { db, pool } = createDbConnection();
  try {
    await db.transaction(async tx => {
      await deleteOutputProductFixtures(tx, eq(biocharProducts.storageLocationId, storageLocationId));
    });
  } finally {
    await pool.end();
  }
}
