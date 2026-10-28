/**
 * An entry recorded after its batch's Removal was sent (#1059), for the late
 * entry screens: a fully applied batch that ended in September with its
 * Removal sent, an Electricity use entry recorded afterwards, and a later
 * draft Removal of the same facility that can take it. `dropReceiver` removes
 * the draft so the entry waits for a Removal.
 */
import * as crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../../src/db/schema";
import { chainSeedRefs, seedGroupedRemovalWithChain } from "./certification-helpers";
import { createDbConnection } from "./db";
import type { SeededChainData } from "./seed-chain-data";

const TEMPLATE_ID = "e2e-late-entry-template";
const COMPONENT = { id: "e2e-electricity", name: "Electricity use" };
const BLUEPRINT = "grid_electricity_use";
const INPUT = "electricity_use";
const UNIT = "kWh";
const ORIGIN_SENT_AT = new Date("2026-09-24T09:00:00Z");
const APPLIED_DRY_KG = 95;
export const LATE_ENTRY_DAY = "2026-09-14";

export interface SeededLateEntry {
  origin: { creditBatchId: string; creditBatchCode: string; removalId: string; removalCode: string };
  receiver: { creditBatchCode: string; removalCode: string };
  entryId: string;
  /** Removes the later draft Removal, so the entry has no Removal to go into. */
  dropReceiver: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export async function seedLateEntry(seededData: SeededChainData, tag: string): Promise<SeededLateEntry> {
  const origin = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), `${tag}A`);
  let receiver: Awaited<ReturnType<typeof seedGroupedRemovalWithChain>> | null = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), `${tag}B`);
  const receiverRef = receiver;
  const { db, pool } = createDbConnection();
  const entryId = crypto.randomUUID();
  try {
    const [observation] = await db.insert(schema.removalTemplateObservations).values({
      organizationId: DEC_ORG_ID, provider: "isometric", externalProjectId: "prj_e2e_late", externalTemplateId: `${TEMPLATE_ID}-${tag}`,
      semanticFingerprint: `e2e-late-${tag}`, fullFingerprint: `e2e-late-${tag}`,
      definition: { groups: [{ id: "e2e-group", key: "operations", displayName: "Operations", description: "", components: [{
        id: COMPONENT.id, displayName: COMPONENT.name, description: null, blueprintKey: BLUEPRINT,
        inputs: [{ key: INPUT, type: "monitored" as const, quantityKind: "energy" as const }] }] }] },
      enrichment: { [COMPONENT.id]: { [INPUT]: { unit: UNIT } } },
      lineSources: { [COMPONENT.id]: { scope: "operating" as const, entryPolicy: "additive" as const, origin: "reviewed" as const } },
    }).returning();
    const templateId = observation.externalTemplateId;
    const byId = (table: typeof schema.creditBatches, id: string) => and(eq(table.organizationId, DEC_ORG_ID), eq(table.id, id));
    // The origin ended in September and everything it produced was applied.
    await db.update(schema.creditBatches).set({ startDate: "2026-09-01", endDate: "2026-09-15", removalTemplateId: templateId })
      .where(byId(schema.creditBatches, origin.creditBatch.id));
    await db.update(schema.creditBatches).set({ startDate: "2026-09-16", endDate: "2026-10-03", removalTemplateId: templateId })
      .where(byId(schema.creditBatches, receiverRef.creditBatch.id));
    const runs = await db.select({ id: schema.creditBatchProductionRuns.productionRunId }).from(schema.creditBatchProductionRuns)
      .where(eq(schema.creditBatchProductionRuns.creditBatchId, origin.creditBatch.id));
    await db.update(schema.productionRuns).set({ biocharDryMassKg: APPLIED_DRY_KG })
      .where(inArray(schema.productionRuns.id, runs.map((run) => run.id)));
    await db.update(schema.certifierRemovals).set({ startedOn: "2026-09-01", completedOn: "2026-09-15" })
      .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, origin.removalId)));
    await db.insert(schema.certificationSubmissions).values({
      organizationId: DEC_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: origin.removalId, version: 1, status: "submitted", externalId: `rmv_e2e_late_${tag}`,
      payloadHash: `e2e-late-${tag}`, submittedAt: ORIGIN_SENT_AT,
      payloadSnapshot: { templateObservationId: observation.id, sourceBindingPlan: [], transport: { removalSupplierRef: `e2e-${tag}`, datapointBodies: [], omittedTemplateComponentIds: [] },
        semantic: { externalProjectId: "prj_e2e_late", templateId, entryContributions: [], inputs: [], candidateSources: [], biocharApplicationIntents: [] } },
    });
    await db.insert(schema.emissionEntries).values({
      organizationId: DEC_ORG_ID, id: entryId, creditBatchId: origin.creditBatch.id, removalTemplateId: templateId,
      componentId: COMPONENT.id, inputShape: [{ key: INPUT, type: "monitored" as const, quantityKind: "energy" as const }],
      lineRule: "additive" as const, observationId: observation.id, kind: "value" as const, occurredOn: LATE_ENTRY_DAY,
      note: "Invoice came late",
    });
    await db.insert(schema.emissionEntryValues).values({ organizationId: DEC_ORG_ID, entryId, inputKey: INPUT, magnitude: "120", unit: UNIT });
    await db.insert(schema.documents).values({
      organizationId: DEC_ORG_ID, entityType: "emission_entry", entityId: entryId, documentType: "invoice",
      fileUrl: `https://evidence.example.test/${entryId}/invoice.pdf`, fileName: "electricity-invoice-14-sep.pdf", uploadStatus: "uploaded",
    });
    const code = async (id: string) => (await db.select({ code: schema.certifierRemovals.code }).from(schema.certifierRemovals)
      .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, id))))[0].code;
    const removalCode = await code(origin.removalId);
    const receiverRemovalCode = await code(receiverRef.removalId);
    const sweep = async () => {
      const conn = createDbConnection();
      try {
        await conn.db.delete(schema.documents).where(and(eq(schema.documents.entityType, "emission_entry"), eq(schema.documents.entityId, entryId)));
        await conn.db.delete(schema.emissionEntryValues).where(eq(schema.emissionEntryValues.entryId, entryId));
        await conn.db.delete(schema.emissionEntries).where(eq(schema.emissionEntries.id, entryId));
        await conn.db.delete(schema.certificationSubmissions).where(and(
          eq(schema.certificationSubmissions.organizationId, DEC_ORG_ID), eq(schema.certificationSubmissions.localEntityId, origin.removalId)));
        for (const batchId of [origin.creditBatch.id, receiverRef.creditBatch.id]) {
          await conn.db.update(schema.creditBatches).set({ removalTemplateId: null }).where(byId(schema.creditBatches, batchId));
        }
        await conn.db.delete(schema.removalTemplateObservations).where(eq(schema.removalTemplateObservations.id, observation.id));
      } finally {
        await conn.pool.end();
      }
    };
    return {
      origin: { creditBatchId: origin.creditBatch.id, creditBatchCode: origin.creditBatch.code, removalId: origin.removalId, removalCode },
      receiver: { creditBatchCode: receiverRef.creditBatch.code, removalCode: receiverRemovalCode },
      entryId,
      dropReceiver: async () => {
        if (!receiver) return;
        await receiver.cleanup();
        receiver = null;
      },
      cleanup: async () => {
        // The batches keep the template pinned until the entry and observation are gone.
        await sweep();
        if (receiver) await receiver.cleanup();
        await origin.cleanup();
      },
    };
  } finally {
    await pool.end();
  }
}
