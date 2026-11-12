/**
 * A credit batch on a Removal template with one electricity component whose
 * proof setting is `lineFile` (one file for the From records amount), fed by
 * the ready chain's production run (it records electricity, no Removal). `cleanup` removes the component files, the
 * template and the chain.
 */
import { and, eq, inArray } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { SOURCE_IDS } from "@/lib/isometric/template-observations/catalog-sources";
import * as schema from "../../../src/db/schema";
import { chainSeedRefs, seedUngroupedReadyBatchWithChain } from "./certification-helpers";
import { createDbConnection } from "./db";
import type { SeededChainData } from "./seed-chain-data";

export const LINE_FILE_COMPONENT_NAME = "E2E Metered electricity";
const LINE_FILE_ELECTRICITY_KWH = 120;

export interface SeededLineFile {
  creditBatchId: string;
  creditBatchCode: string;
  cleanup: () => Promise<void>;
}

export async function seedLineFileComponent(seededData: SeededChainData, tag: string): Promise<SeededLineFile> {
  // A ready batch with no Removal: its production run records electricity, so the From records amount needs a file.
  const chain = await seedUngroupedReadyBatchWithChain(chainSeedRefs(seededData), tag);
  const componentId = `rtc_e2e_line_file_${tag}`;
  const { db, pool } = createDbConnection();
  try {
    const [observation] = await db.insert(schema.removalTemplateObservations).values({
      organizationId: DEC_ORG_ID, provider: "isometric", externalProjectId: "prj_e2e_line_file", externalTemplateId: `e2e-line-file-template-${tag}`,
      semanticFingerprint: `e2e-line-file-${tag}`, fullFingerprint: `e2e-line-file-${tag}`,
      definition: { groups: [{ id: `rtg_e2e_line_file_${tag}`, key: "direct-emissions", displayName: "Direct emissions", description: "", components: [{
        id: componentId, displayName: LINE_FILE_COMPONENT_NAME, description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }],
      }] }] },
      enrichment: { [componentId]: { electricity_use: { unit: "kWh", deprecated: null } } },
      lineSources: { [componentId]: {
        scope: "operating" as const, automaticSource: SOURCE_IDS.totalElectricityKwh, entryPolicy: "additive" as const, origin: "reviewed" as const, filePolicy: "lineFile" as const,
      } },
    }).returning();
    await db.update(schema.creditBatches).set({ removalTemplateId: observation.externalTemplateId })
      .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, chain.creditBatchId)));
    // The ready chain records 0 kWh, which needs no file; give the batch's run a metered amount.
    const runIds = db.select({ id: schema.creditBatchProductionRuns.productionRunId }).from(schema.creditBatchProductionRuns)
      .where(eq(schema.creditBatchProductionRuns.creditBatchId, chain.creditBatchId));
    await db.update(schema.productionRuns).set({ electricityKwh: LINE_FILE_ELECTRICITY_KWH })
      .where(and(eq(schema.productionRuns.organizationId, DEC_ORG_ID), inArray(schema.productionRuns.id, runIds)));
    return {
      creditBatchId: chain.creditBatchId,
      creditBatchCode: chain.code,
      cleanup: async () => {
        const conn = createDbConnection();
        try {
          const anchors = await conn.db.select({ id: schema.emissionLineFiles.id }).from(schema.emissionLineFiles)
            .where(eq(schema.emissionLineFiles.creditBatchId, chain.creditBatchId));
          const ids = anchors.map((anchor) => anchor.id);
          if (ids.length) {
            await conn.db.delete(schema.documents).where(and(eq(schema.documents.entityType, "emission_line"), inArray(schema.documents.entityId, ids)));
            await conn.db.delete(schema.emissionLineFiles).where(inArray(schema.emissionLineFiles.id, ids));
          }
          // The batch keeps the template pinned until the observation is gone.
          await conn.db.update(schema.creditBatches).set({ removalTemplateId: null })
            .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, chain.creditBatchId)));
          await conn.db.delete(schema.removalTemplateObservations).where(eq(schema.removalTemplateObservations.id, observation.id));
        } finally {
          await conn.pool.end();
        }
        await chain.cleanup();
      },
    };
  } finally {
    await pool.end();
  }
}
