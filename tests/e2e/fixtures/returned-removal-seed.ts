/**
 * A sent Removal whose GHG Statement Isometric returned, for the correction
 * screens. The statement's remote status is read live by the record-lock
 * lineage, so the app server must answer `GET /ghg_statements/<id>` for the
 * seeded external ids (see `returnedStatementRemote`). The Removal's manifest
 * is compiled from its sent records before any correction edits are applied.
 */
import * as crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { encryptSecret } from "@/lib/crypto/secrets";
import * as schema from "../../../src/db/schema";
import {
  chainSeedRefs,
  deleteCertifierMapping,
  seedCertifierMapping,
  seedUngroupedReadyBatchWithChain,
  type SeededGroupedRemoval,
} from "./certification-helpers";
import { createDbConnection } from "./db";
import { insertRemovalFixture } from "../../helpers/removal-fixture";
import { assertReturnedRemovalComparison, compileReturnedRemovalSnapshot } from "./returned-removal-snapshot";
import type { SeededChainData } from "./seed-chain-data";

/** The one template the registry stub serves, shared by every seeded Removal. */
export const RETURNED_TEMPLATE_ID = "e2e-returned-template";
export const RETURNED_REMOVAL_EXTERNAL_PREFIX = "rmv_e2e_returned_";
export const RETURNED_STATEMENT_EXTERNAL_PREFIX = "ghg_e2e_returned_";
export const RETURNED_STATEMENT_DRAFT_MARK = "_draft_";

const REMOVAL_SUBMITTED_AT = new Date("2026-10-01T09:00:00Z");
const STATEMENT_RETURNED_AT = "2026-10-05T09:00:00Z";
/** Two additive operating components on a stock blueprint, so the batch lines read as set up. */
const COMPONENTS = [
  { id: "e2e-diesel", name: "Diesel use" },
  { id: "e2e-transport", name: "Transport to field" },
] as const;
const BLUEPRINT = "grid_electricity_use";
const INPUT = "electricity_use";
const UNIT = "kWh";
const SENT_MAGNITUDE = "10";
const REPLACEMENT_MAGNITUDE = "12";
const CORRECTED_AT = new Date("2026-10-06T09:00:00Z");
const ENTRY_EVIDENCE_URL = "https://example.invalid/e2e-emission-entry.pdf";
const STORAGE_COMPONENT_ID = "e2e-returned-storage";
const STORAGE_BLUEPRINT = "carbon_rich_substance_sequestration";
const STORAGE_INPUTS = [
  { key: "carbon_content", type: "monitored" as const, quantityKind: "dimensionless" as const },
  { key: "product_mass", type: "monitored" as const, quantityKind: "mass" as const },
];

/** The returned-statement read needs the app server's registry call answered (a fetch preload on the dev server). */
export function returnedRemovalSeedsEnabled(): boolean {
  return Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY) && process.env.RETURNED_STATEMENT_STUB === "1";
}

type Db = ReturnType<typeof createDbConnection>["db"];

/** Entries go with their files and values, after the replacement links that would block the delete. */
async function deleteEmissionEntries(db: Db, entryIds: string[]): Promise<void> {
  if (!entryIds.length) return;
  await db.delete(schema.documents).where(and(
    eq(schema.documents.organizationId, DEC_ORG_ID), eq(schema.documents.entityType, "emission_entry"),
    inArray(schema.documents.entityId, entryIds)));
  await db.update(schema.emissionEntries).set({ replacesEntryId: null }).where(and(
    eq(schema.emissionEntries.organizationId, DEC_ORG_ID), inArray(schema.emissionEntries.id, entryIds)));
  await db.delete(schema.emissionEntryValues).where(and(
    eq(schema.emissionEntryValues.organizationId, DEC_ORG_ID), inArray(schema.emissionEntryValues.entryId, entryIds)));
  await db.delete(schema.emissionEntries).where(and(
    eq(schema.emissionEntries.organizationId, DEC_ORG_ID), inArray(schema.emissionEntries.id, entryIds)));
}

export interface ReturnedRemovalOptions {
  adminUserId: string;
  /** True: the sent components changed since the Removal was sent. */
  changed: boolean;
  statementStatus: "FAILED_VERIFICATION" | "DRAFT";
  periodStartOn: string;
  periodEndOn: string;
  /** Fields merged into the sent snapshot's semantic content, to describe records as they were when it was sent. */
  sentSemantic?: Record<string, unknown>;
}

export interface SeededReturnedRemoval extends SeededGroupedRemoval {
  statementId: string;
  statementExternalId: string;
  removalCode: string;
}

/** A Removal and its returned statement, on its own credit batch. */
export async function seedReturnedRemoval(
  seededData: SeededChainData,
  tag: string,
  options: ReturnedRemovalOptions,
): Promise<SeededReturnedRemoval> {
  const ready = await seedUngroupedReadyBatchWithChain(chainSeedRefs(seededData), tag, { transportEvidence: false });
  const grouped: SeededGroupedRemoval = {
    removalId: crypto.randomUUID(),
    creditBatch: { id: ready.creditBatchId, code: ready.code },
    cleanup: async () => {
      await ready.cleanup();
      const conn = createDbConnection();
      try {
        await conn.db.delete(schema.certifierRemovals).where(and(
          eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, grouped.removalId)));
      } finally {
        await conn.pool.end();
      }
    },
  };
  const facilityId = seededData.facility.id;
  const templateId = RETURNED_TEMPLATE_ID;
  const statementId = crypto.randomUUID();
  const removalExternalId = `${RETURNED_REMOVAL_EXTERNAL_PREFIX}${tag}`;
  const statementExternalId = `${RETURNED_STATEMENT_EXTERNAL_PREFIX}${options.statementStatus === "DRAFT" ? `${RETURNED_STATEMENT_DRAFT_MARK}` : ""}${tag}`;
  const cleanup = async () => {
    const conn = createDbConnection();
    try {
      const ids = [grouped.removalId, statementId];
      for (const id of ids) {
        await conn.db.delete(schema.certificationSubmissions).where(and(
          eq(schema.certificationSubmissions.organizationId, DEC_ORG_ID), eq(schema.certificationSubmissions.localEntityId, id)));
      }
      const entryIds = (await conn.db.select({ id: schema.emissionEntries.id }).from(schema.emissionEntries).where(and(
        eq(schema.emissionEntries.organizationId, DEC_ORG_ID), eq(schema.emissionEntries.creditBatchId, grouped.creditBatch.id)))).map((row) => row.id);
      await deleteEmissionEntries(conn.db, entryIds);
      await conn.db.update(schema.certifierRemovals).set({ ghgStatementId: null })
        .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, grouped.removalId)));
      await conn.db.delete(schema.certifierGhgStatements).where(and(
        eq(schema.certifierGhgStatements.organizationId, DEC_ORG_ID), eq(schema.certifierGhgStatements.id, statementId)));
      await conn.db.update(schema.creditBatches).set({ removalTemplateId: null })
        .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, grouped.creditBatch.id)));
    } finally {
      await conn.pool.end();
    }
    await grouped.cleanup();
  };
  const { db, pool } = createDbConnection();
  try {
    await insertRemovalFixture(db, {
      organizationId: DEC_ORG_ID, id: grouped.removalId, facilityId, provider: "isometric",
    });
    await db.update(schema.creditBatchApplications).set({ removalId: grouped.removalId }).where(and(
      eq(schema.creditBatchApplications.organizationId, DEC_ORG_ID), eq(schema.creditBatchApplications.creditBatchId, ready.creditBatchId)));
    const [observation] = await db.insert(schema.removalTemplateObservations).values({
      organizationId: DEC_ORG_ID,
      provider: "isometric",
      externalProjectId: "prj_e2e_returned",
      externalTemplateId: templateId,
      semanticFingerprint: `e2e-returned-${tag}`,
      fullFingerprint: `e2e-returned-${tag}`,
      definition: {
        groups: [{
          id: "e2e-group", key: "operations", displayName: "Operations", description: "",
          components: COMPONENTS.map((component) => ({
            id: component.id, displayName: component.name, description: null, blueprintKey: BLUEPRINT,
            inputs: [{ key: INPUT, type: "monitored" as const, quantityKind: "energy" as const }],
          })),
        }, {
          id: "e2e-storage-group", key: "co2-stored", displayName: "CO2 stored", description: "",
          components: [{ id: STORAGE_COMPONENT_ID, displayName: "Sequestration", description: null, blueprintKey: STORAGE_BLUEPRINT,
            inputs: STORAGE_INPUTS }],
        }],
      },
      enrichment: { ...Object.fromEntries(COMPONENTS.map((component) => [component.id, { [INPUT]: { unit: UNIT } }])),
        [STORAGE_COMPONENT_ID]: { carbon_content: { unit: "dimensionless" }, product_mass: { unit: "kg" } } },
      lineSources: { ...Object.fromEntries(COMPONENTS.map((component) => [component.id,
        { scope: "operating" as const, entryPolicy: "additive" as const, origin: "reviewed" as const }])),
        [STORAGE_COMPONENT_ID]: { scope: "operating", entryPolicy: "none", automaticSource: "sequestration", origin: "reviewed" } },
    }).returning();
    // Include the historical usage day used by the comparison-unavailable spec.
    await db.update(schema.creditBatches).set({ removalTemplateId: templateId, startDate: options.periodStartOn })
      .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, grouped.creditBatch.id)));
    await db.insert(schema.certifierGhgStatements).values({
      organizationId: DEC_ORG_ID, id: statementId, facilityId,
      reportingPeriodStartOn: options.periodStartOn, reportingPeriodEndOn: options.periodEndOn,
    });
    await db.update(schema.certifierRemovals).set({
      ghgStatementId: statementId, startedOn: options.periodStartOn, completedOn: options.periodEndOn,
    }).where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, grouped.removalId)));
    // The ready batch's own end date (set with its application), so the entries never straddle a midnight.
    const [seededBatch] = await db.select({ endDate: schema.creditBatches.endDate }).from(schema.creditBatches)
      .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, grouped.creditBatch.id)));
    const occurredOn = seededBatch.endDate;
    const sentEntryIds = COMPONENTS.map(() => crypto.randomUUID());
    const entryBase = {
      organizationId: DEC_ORG_ID, creditBatchId: grouped.creditBatch.id, removalTemplateId: templateId,
      inputShape: [{ key: INPUT, type: "monitored" as const, quantityKind: "energy" as const }],
      lineRule: "additive" as const, observationId: observation.id, occurredOn,
    };
    // Only Diesel has a sent value. Transport was explicitly confirmed as zero.
    await db.insert(schema.emissionEntries).values(COMPONENTS.map((component, index) => ({
      ...entryBase, id: sentEntryIds[index], componentId: component.id,
      kind: options.changed && index === 0 ? "value" as const : "zero" as const,
      confirmedForRemovalId: options.changed && index === 0 ? null : grouped.removalId,
      sentByRemovalId: grouped.removalId,
    })));
    const entryDocument = (entryId: string): typeof schema.documents.$inferInsert => ({
      organizationId: DEC_ORG_ID, entityType: "emission_entry", entityId: entryId,
      documentType: "pdf", fileName: `e2e-entry-${entryId}.pdf`, fileUrl: ENTRY_EVIDENCE_URL,
      mimeType: "application/pdf", uploadStatus: "uploaded",
    });
    if (options.changed) {
      await db.insert(schema.emissionEntryValues).values({
        organizationId: DEC_ORG_ID, entryId: sentEntryIds[0], inputKey: INPUT, magnitude: SENT_MAGNITUDE, unit: UNIT,
      });
      await db.insert(schema.documents).values(entryDocument(sentEntryIds[0]));
    }
    const sentSnapshot = await compileReturnedRemovalSnapshot(grouped.removalId, options.adminUserId, observation);
    await db.insert(schema.certificationSubmissions).values({
      organizationId: DEC_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: grouped.removalId, version: 1, status: "submitted", externalId: removalExternalId,
      payloadHash: `e2e-returned-${tag}`, submittedAt: REMOVAL_SUBMITTED_AT,
      payloadSnapshot: { ...sentSnapshot, semantic: { ...sentSnapshot.semantic, ...options.sentSemantic } },
    });
    if (options.changed) {
      // Keep the sent owner on retired entries; the replacement is held for resubmit.
      await db.update(schema.emissionEntries).set({ deletedAt: CORRECTED_AT }).where(and(
        eq(schema.emissionEntries.organizationId, DEC_ORG_ID), inArray(schema.emissionEntries.id, sentEntryIds)));
      const replacementId = crypto.randomUUID();
      await db.insert(schema.emissionEntries).values([
        { ...entryBase, id: replacementId, componentId: COMPONENTS[0].id, kind: "value", replacesEntryId: sentEntryIds[0] },
        // An empty additive line cannot compile. A fresh zero retires Transport's sent entry.
        { ...entryBase, componentId: COMPONENTS[1].id, kind: "zero", confirmedForRemovalId: grouped.removalId },
      ]);
      await db.insert(schema.emissionEntryValues).values({
        organizationId: DEC_ORG_ID, entryId: replacementId, inputKey: INPUT, magnitude: REPLACEMENT_MAGNITUDE, unit: UNIT,
      });
      await db.insert(schema.documents).values(entryDocument(replacementId));
    }
    await db.insert(schema.certificationSubmissions).values({
      organizationId: DEC_ORG_ID, provider: "isometric", submissionType: "ghg_statement", localEntityType: "ghgStatement",
      localEntityId: statementId, version: 1, status: "submitted", externalId: statementExternalId,
      payloadHash: `e2e-returned-statement-${tag}`, submittedAt: REMOVAL_SUBMITTED_AT,
      metadata: { remoteStatus: options.statementStatus, removalIds: [removalExternalId], submittedToVerifierAt: STATEMENT_RETURNED_AT },
    });
    await assertReturnedRemovalComparison(grouped.removalId, options.adminUserId,
      options.sentSemantic ? undefined : options.changed ? COMPONENTS.map(component => component.id) : []);
    const [removal] = await db.select({ code: schema.certifierRemovals.code }).from(schema.certifierRemovals)
      .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, grouped.removalId)));
    return {
      ...grouped,
      statementId, statementExternalId, removalCode: removal.code,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    await pool.end();
  }
}

/** After checking corrections, deliberately empty both lines to exercise the wizard's zero step. */
export async function emptyReturnedRemovalComponentsForWizard(creditBatchId: string): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db.update(schema.emissionEntries).set({ deletedAt: new Date() }).where(and(
      eq(schema.emissionEntries.organizationId, DEC_ORG_ID), eq(schema.emissionEntries.creditBatchId, creditBatchId)));
  } finally {
    await pool.end();
  }
}

/** The registry connection the record-lock lineage needs before it reads a statement. */
export async function seedReturnedConnection(facilityId: string): Promise<() => Promise<void>> {
  const mapping = await seedCertifierMapping(facilityId, { externalProjectId: "prj_e2e_returned", removalTemplateId: RETURNED_TEMPLATE_ID });
  const { db, pool } = createDbConnection();
  let createdCredentials = false;
  try {
    const existing = await db.select({ id: schema.certifierCredentials.id }).from(schema.certifierCredentials)
      .where(and(eq(schema.certifierCredentials.organizationId, DEC_ORG_ID), eq(schema.certifierCredentials.provider, "isometric")));
    if (existing.length === 0) {
      await db.insert(schema.certifierCredentials).values({
        organizationId: DEC_ORG_ID, provider: "isometric",
        accessTokenEncrypted: encryptSecret("e2e-returned-access"), clientSecretEncrypted: encryptSecret("e2e-returned-secret"),
      });
      createdCredentials = true;
    }
  } finally {
    await pool.end();
  }
  return async () => {
    // The app observes the served template too: every observation of it goes, after every Removal's entries.
    const observations = createDbConnection();
    try {
      // The wizard and the app can write entries of their own against the served template; they go first.
      const observationIds = (await observations.db.select({ id: schema.removalTemplateObservations.id }).from(schema.removalTemplateObservations).where(and(
        eq(schema.removalTemplateObservations.organizationId, DEC_ORG_ID),
        eq(schema.removalTemplateObservations.externalTemplateId, RETURNED_TEMPLATE_ID)))).map((row) => row.id);
      if (observationIds.length) {
        const strayIds = (await observations.db.select({ id: schema.emissionEntries.id }).from(schema.emissionEntries).where(and(
          eq(schema.emissionEntries.organizationId, DEC_ORG_ID), inArray(schema.emissionEntries.observationId, observationIds)))).map((row) => row.id);
        await deleteEmissionEntries(observations.db, strayIds);
      }
      await observations.db.delete(schema.removalTemplateObservations).where(and(
        eq(schema.removalTemplateObservations.organizationId, DEC_ORG_ID),
        eq(schema.removalTemplateObservations.externalTemplateId, RETURNED_TEMPLATE_ID)));
    } finally {
      await observations.pool.end();
    }
    if (createdCredentials) {
      const conn = createDbConnection();
      try {
        await conn.db.delete(schema.certifierCredentials).where(and(
          eq(schema.certifierCredentials.organizationId, DEC_ORG_ID), eq(schema.certifierCredentials.provider, "isometric")));
      } finally {
        await conn.pool.end();
      }
    }
    await mapping.cleanup();
    await deleteCertifierMapping(facilityId);
  };
}
