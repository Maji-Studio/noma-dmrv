/**
 * A sent Removal whose GHG Statement Isometric returned, for the correction
 * screens. The statement's remote status is read live by the record-lock
 * lineage, so the app server must answer `GET /ghg_statements/<id>` for the
 * seeded external ids (see `returnedStatementRemote`). The Removal's manifest
 * is stored on its submission snapshot: with `changed` the sent entries are
 * gone from the live ledger, so every sent component reads as changed.
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
  seedGroupedRemovalWithChain,
  type SeededGroupedRemoval,
} from "./certification-helpers";
import { createDbConnection } from "./db";
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

/** The returned-statement read needs the app server's registry call answered (a fetch preload on the dev server). */
export function returnedRemovalSeedsEnabled(): boolean {
  return Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY) && process.env.RETURNED_STATEMENT_STUB === "1";
}

export interface ReturnedRemovalOptions {
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
  const grouped = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), tag);
  const facilityId = seededData.facility.id;
  const templateId = RETURNED_TEMPLATE_ID;
  const statementId = crypto.randomUUID();
  const removalExternalId = `${RETURNED_REMOVAL_EXTERNAL_PREFIX}${tag}`;
  const statementExternalId = `${RETURNED_STATEMENT_EXTERNAL_PREFIX}${options.statementStatus === "DRAFT" ? `${RETURNED_STATEMENT_DRAFT_MARK}` : ""}${tag}`;
  const { db, pool } = createDbConnection();
  try {
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
        }],
      },
      enrichment: Object.fromEntries(COMPONENTS.map((component) => [component.id, { [INPUT]: { unit: UNIT } }])),
      lineSources: Object.fromEntries(COMPONENTS.map((component) => [component.id,
        { scope: "operating" as const, entryPolicy: "additive" as const, origin: "reviewed" as const }])),
    }).returning();
    await db.update(schema.creditBatches).set({ removalTemplateId: templateId })
      .where(and(eq(schema.creditBatches.organizationId, DEC_ORG_ID), eq(schema.creditBatches.id, grouped.creditBatch.id)));
    await db.insert(schema.certifierGhgStatements).values({
      organizationId: DEC_ORG_ID, id: statementId, facilityId,
      reportingPeriodStartOn: options.periodStartOn, reportingPeriodEndOn: options.periodEndOn,
    });
    await db.update(schema.certifierRemovals).set({
      ghgStatementId: statementId, startedOn: options.periodStartOn, completedOn: options.periodEndOn,
    }).where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, grouped.removalId)));
    const sentEntryIds = COMPONENTS.map(() => crypto.randomUUID());
    const manifest = options.changed ? COMPONENTS.map((component, index) => ({
      componentId: component.id, inputKey: INPUT,
      entries: [{
        entryId: sentEntryIds[index], creditBatchId: grouped.creditBatch.id, contentRevision: 1,
        kind: "value" as const, value: { magnitude: "10", unit: UNIT }, evidenceDocumentIds: [],
      }],
    })) : [];
    if (options.changed) {
      // The first component was sent, then re-entered: the sent entry is retired and its
      // replacement waits for the Removal to be resubmitted. The second sent entry was deleted.
      const base = {
        organizationId: DEC_ORG_ID, creditBatchId: grouped.creditBatch.id, removalTemplateId: templateId,
        componentId: COMPONENTS[0].id, inputShape: [{ key: INPUT, type: "monitored" as const, quantityKind: "energy" as const }],
        lineRule: "additive" as const, observationId: observation.id, kind: "value" as const, occurredOn: "2026-09-10",
      };
      const replacementId = crypto.randomUUID();
      await db.insert(schema.emissionEntries).values([
        { ...base, id: sentEntryIds[0], sentByRemovalId: grouped.removalId, deletedAt: new Date("2026-10-06T09:00:00Z") },
        { ...base, id: replacementId, replacesEntryId: sentEntryIds[0] },
      ]);
      await db.insert(schema.emissionEntryValues).values([
        { organizationId: DEC_ORG_ID, entryId: sentEntryIds[0], inputKey: INPUT, magnitude: "10", unit: UNIT },
        { organizationId: DEC_ORG_ID, entryId: replacementId, inputKey: INPUT, magnitude: "12", unit: UNIT },
      ]);
    }
    await db.insert(schema.certificationSubmissions).values({
      organizationId: DEC_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: grouped.removalId, version: 1, status: "submitted", externalId: removalExternalId,
      payloadHash: `e2e-returned-${tag}`, submittedAt: REMOVAL_SUBMITTED_AT,
      payloadSnapshot: {
        templateObservationId: observation.id,
        sourceBindingPlan: [],
        transport: { removalSupplierRef: `e2e-${tag}`, datapointBodies: [], omittedTemplateComponentIds: [] },
        semantic: {
          externalProjectId: "prj_e2e_returned", templateId, entryContributions: manifest,
          inputs: [], candidateSources: [], biocharApplicationIntents: [], ...options.sentSemantic,
        },
      },
    });
    await db.insert(schema.certificationSubmissions).values({
      organizationId: DEC_ORG_ID, provider: "isometric", submissionType: "ghg_statement", localEntityType: "ghgStatement",
      localEntityId: statementId, version: 1, status: "submitted", externalId: statementExternalId,
      payloadHash: `e2e-returned-statement-${tag}`, submittedAt: REMOVAL_SUBMITTED_AT,
      metadata: { remoteStatus: options.statementStatus, removalIds: [removalExternalId], submittedToVerifierAt: STATEMENT_RETURNED_AT },
    });
    const [removal] = await db.select({ code: schema.certifierRemovals.code }).from(schema.certifierRemovals)
      .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, grouped.removalId)));
    return {
      ...grouped,
      statementId, statementExternalId, removalCode: removal.code,
      cleanup: async () => {
        const conn = createDbConnection();
        try {
          const ids = [grouped.removalId, statementId];
          for (const id of ids) {
            await conn.db.delete(schema.certificationSubmissions).where(and(
              eq(schema.certificationSubmissions.organizationId, DEC_ORG_ID), eq(schema.certificationSubmissions.localEntityId, id)));
          }
          const entryIds = (await conn.db.select({ id: schema.emissionEntries.id }).from(schema.emissionEntries).where(and(
            eq(schema.emissionEntries.organizationId, DEC_ORG_ID), eq(schema.emissionEntries.creditBatchId, grouped.creditBatch.id)))).map((row) => row.id);
          if (entryIds.length) {
            await conn.db.delete(schema.emissionEntryValues).where(and(
              eq(schema.emissionEntryValues.organizationId, DEC_ORG_ID), inArray(schema.emissionEntryValues.entryId, entryIds)));
            await conn.db.delete(schema.emissionEntries).where(and(
              eq(schema.emissionEntries.organizationId, DEC_ORG_ID), inArray(schema.emissionEntries.id, entryIds)));
          }
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
      },
    };
  } finally {
    await pool.end();
  }
}

/** The registry connection the record-lock lineage needs before it reads a statement. */
export async function seedReturnedConnection(facilityId: string): Promise<() => Promise<void>> {
  const mapping = await seedCertifierMapping(facilityId, { externalProjectId: "prj_e2e_returned" });
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
