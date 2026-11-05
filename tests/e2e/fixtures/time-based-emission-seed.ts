/**
 * A credit batch on a Removal template with one Isometric `time_based_emissions`
 * line (a fixed kgCO2e/hour rate times monitored hours), modeled on the sandbox
 * template of 2026-11-05. The line is operating and additive, so an operator can
 * add hours entries. `cleanup` removes the entries, the template and the chain.
 */
import { and, eq, inArray } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../../src/db/schema";
import { chainSeedRefs, seedGroupedRemovalWithChain } from "./certification-helpers";
import { createDbConnection } from "./db";
import type { SeededChainData } from "./seed-chain-data";

export const TIME_LINE_NAME = "Pyrolyzer CH₄ time emissions";
const RATE_KG_CO2E_PER_HOUR = 0.41264;

export interface SeededTimeBasedLine {
  creditBatchId: string;
  creditBatchCode: string;
  cleanup: () => Promise<void>;
}

export async function seedTimeBasedLine(seededData: SeededChainData, tag: string): Promise<SeededTimeBasedLine> {
  const chain = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), tag);
  const componentId = `rtc_e2e_time_${tag}`;
  const { db, pool } = createDbConnection();
  try {
    const [observation] = await db.insert(schema.removalTemplateObservations).values({
      organizationId: DEC_ORG_ID, provider: "isometric", externalProjectId: "prj_e2e_time", externalTemplateId: `e2e-time-template-${tag}`,
      semanticFingerprint: `e2e-time-${tag}`, fullFingerprint: `e2e-time-${tag}`,
      definition: { groups: [{ id: `rtg_e2e_time_${tag}`, key: "direct-emissions", displayName: "Direct emissions", description: "", components: [{
        id: componentId, displayName: TIME_LINE_NAME, description: null, blueprintKey: "time_based_emissions",
        inputs: [
          { key: "emissions_per_unit_time", type: "fixed" as const, quantityKind: "time_emission_factor" as const, fixedDatapointId: "dtp_e2e_rate" },
          { key: "time", type: "monitored" as const, quantityKind: "time" as const },
        ] }] }] },
      enrichment: { [componentId]: {
        emissions_per_unit_time: { unit: "kgCO2e / hour", fixedValue: RATE_KG_CO2E_PER_HOUR, deprecated: null },
        time: { unit: "hour", deprecated: null },
      } },
      lineSources: { [componentId]: { scope: "operating" as const, entryPolicy: "additive" as const, origin: "reviewed" as const } },
    }).returning();
    await db.update(schema.creditBatches).set({ removalTemplateId: observation.externalTemplateId })
      .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, chain.creditBatch.id)));
    return {
      creditBatchId: chain.creditBatch.id,
      creditBatchCode: chain.creditBatch.code,
      cleanup: async () => {
        const conn = createDbConnection();
        try {
          const entries = await conn.db.select({ id: schema.emissionEntries.id }).from(schema.emissionEntries)
            .where(eq(schema.emissionEntries.creditBatchId, chain.creditBatch.id));
          const ids = entries.map((entry) => entry.id);
          if (ids.length) {
            await conn.db.delete(schema.documents).where(and(eq(schema.documents.entityType, "emission_entry"), inArray(schema.documents.entityId, ids)));
            await conn.db.delete(schema.emissionEntryValues).where(inArray(schema.emissionEntryValues.entryId, ids));
            await conn.db.delete(schema.emissionEntries).where(inArray(schema.emissionEntries.id, ids));
          }
          // The batch keeps the template pinned until the entries and observation are gone.
          await conn.db.update(schema.creditBatches).set({ removalTemplateId: null })
            .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, chain.creditBatch.id)));
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
