import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";

const CREDIT_BATCH_H_TO_CORG_RATIO = 0.4;

export interface SeededIncompleteBatch {
  creditBatchId: string;
  code: string;
  cleanup: () => Promise<void>;
}

/** Seed an ungrouped, intentionally incomplete credit batch. */
export async function seedUngroupedIncompleteBatch(
  refs: { facilityId: string; feedstockTypeId: string },
  testRunId: string,
): Promise<SeededIncompleteBatch> {
  const { db, pool } = createDbConnection();
  const id = {
    creditBatch: crypto.randomUUID(),
    productionProcess: crypto.randomUUID(),
  };
  const code = `E2E-INC-${testRunId}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.productionProcesses).values({
        organizationId: DEC_ORG_ID,
        id: id.productionProcess,
        facilityId: refs.facilityId,
        feedstockTypeId: refs.feedstockTypeId,
      });
      await tx.insert(schema.creditBatches).values({
        organizationId: DEC_ORG_ID,
        id: id.creditBatch,
        code,
        facilityId: refs.facilityId,
        feedstockTypeId: refs.feedstockTypeId,
        productionProcessId: id.productionProcess,
        startDate: today,
        endDate: today,
        status: "draft",
        hToCorgRatio: CREDIT_BATCH_H_TO_CORG_RATIO,
      });
    });
  } finally {
    await pool.end();
  }

  return {
    creditBatchId: id.creditBatch,
    code,
    cleanup: async () => {
      const connection = createDbConnection();
      try {
        await connection.db.transaction(async (tx) => {
          await tx
            .delete(schema.creditBatches)
            .where(eq(schema.creditBatches.id, id.creditBatch));
          await tx
            .delete(schema.productionProcesses)
            .where(eq(schema.productionProcesses.id, id.productionProcess));
        });
      } finally {
        await connection.pool.end();
      }
    },
  };
}
