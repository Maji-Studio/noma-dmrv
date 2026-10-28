/**
 * A completed production run that matches a credit batch but stayed outside it
 * because the batch's Removal was already sent (#1059 part 2), for the late-run
 * Check to-do screen: a batch that ended in September with its Removal sent, and
 * a run of the same facility and feedstock that ended inside the batch period,
 * created after the send, so it was never attached.
 */
import { and, eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../../src/db/schema";
import { chainSeedRefs, seedGroupedRemovalWithChain } from "./certification-helpers";
import { createDbConnection } from "./db";
import type { SeededChainData } from "./seed-chain-data";

const SENT_AT = new Date("2026-09-24T09:00:00Z");
const RUN_START = new Date("2026-09-10T08:00:00Z");
const RUN_END = new Date("2026-09-10T12:00:00Z");
const FEEDSTOCK_USED_KG = 100;

export interface SeededLateRun {
  creditBatchId: string;
  creditBatchCode: string;
  removalCode: string;
  runCode: string;
  cleanup: () => Promise<void>;
}

export async function seedLateRun(seededData: SeededChainData, tag: string): Promise<SeededLateRun> {
  const origin = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), `${tag}A`);
  const { db, pool } = createDbConnection();
  const runId = crypto.randomUUID();
  const runCode = `E2E-PRD-${tag}L`;
  try {
    const byId = (table: typeof schema.creditBatches, id: string) => and(eq(table.organizationId, DEC_ORG_ID), eq(table.id, id));
    await db.update(schema.creditBatches).set({ startDate: "2026-09-01", endDate: "2026-09-15" })
      .where(byId(schema.creditBatches, origin.creditBatch.id));
    await db.update(schema.certifierRemovals).set({ startedOn: "2026-09-01", completedOn: "2026-09-15" })
      .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, origin.removalId)));
    await db.insert(schema.certificationSubmissions).values({
      organizationId: DEC_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: origin.removalId, version: 1, status: "submitted", externalId: `rmv_e2e_late_run_${tag}`,
      payloadHash: `e2e-late-run-${tag}`, submittedAt: SENT_AT,
      payloadSnapshot: { transport: { removalSupplierRef: `e2e-${tag}`, datapointBodies: [], omittedTemplateComponentIds: [] },
        semantic: { externalProjectId: "prj_e2e_late_run", templateId: `e2e-late-run-${tag}`, entryContributions: [], inputs: [], candidateSources: [], biocharApplicationIntents: [] } },
    });
    const [attached] = await db.select().from(schema.creditBatchProductionRuns)
      .where(eq(schema.creditBatchProductionRuns.creditBatchId, origin.creditBatch.id));
    const [source] = await db.select().from(schema.productionRuns)
      .where(and(eq(schema.productionRuns.organizationId, DEC_ORG_ID), eq(schema.productionRuns.id, attached.productionRunId)));
    const [sourceFeedstock] = await db.select().from(schema.productionRunFeedstocks)
      .where(eq(schema.productionRunFeedstocks.productionRunId, source.id));
    await db.insert(schema.productionRuns).values({
      ...source, id: runId, code: runCode, startTime: RUN_START, endTime: RUN_END, createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(schema.productionRunFeedstocks).values({
      ...sourceFeedstock, id: crypto.randomUUID(), productionRunId: runId, wetMassUsedKg: FEEDSTOCK_USED_KG,
    });
    const [removal] = await db.select({ code: schema.certifierRemovals.code }).from(schema.certifierRemovals)
      .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, origin.removalId)));
    return {
      creditBatchId: origin.creditBatch.id, creditBatchCode: origin.creditBatch.code, removalCode: removal.code, runCode,
      cleanup: async () => {
        const conn = createDbConnection();
        try {
          await conn.db.delete(schema.productionRunFeedstocks).where(eq(schema.productionRunFeedstocks.productionRunId, runId));
          await conn.db.delete(schema.productionRuns).where(eq(schema.productionRuns.id, runId));
          await conn.db.delete(schema.certificationSubmissions).where(and(
            eq(schema.certificationSubmissions.organizationId, DEC_ORG_ID), eq(schema.certificationSubmissions.localEntityId, origin.removalId)));
        } finally {
          await conn.pool.end();
        }
        await origin.cleanup();
      },
    };
  } finally {
    await pool.end();
  }
}
