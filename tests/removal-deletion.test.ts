import { createRemovalDeletionFixture, insertLedgerRow, type Fixture } from "./helpers/removal-deletion-fixture";
import { REMOVAL_DELETION_LEASE_KEY } from "@/lib/certification/removal-deletion-lease";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { claimSubmissionDraft } from "@/data-access/certification-submissions";
import { createRemovalWithCreditBatches, discardLocalRemovalDraft } from "@/data-access/certifier-removals";
import { isRemovalProductionBatchShared, assertNoRemovalBatchDeletion } from "@/data-access/removal-production-batch-deletion";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";
/**
 * DB-backed tests for deleting a never-finalized Removal
 * (`src/fn/certification/delete-removal.ts` over
 * `src/data-access/certifier-removal-deletion.ts`).
 *
 * Real Postgres for the claim/finalize seams (row locks, ledger CAS) and the
 * fake registry (`tests/fixtures/fake-registry.ts`) for the DELETE calls.
 * Biochar Application ordering is covered by the colocated unit test on the
 * orchestration; here the registry side is the GHG Entry.
 *
 * Requires a real Postgres (`.env.test`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierDocumentUploads,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { creditBatches, creditBatchApplications } from "@/db/schema/credits";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { buildProductionBatchReference } from "@/lib/isometric/production-batches";
import { buildMeasurementSampleReference } from "@/lib/isometric/measurement-samples";
import { applications } from "@/db/schema/application";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import {
  claimRemovalDeletion,
  finalizeRemovalDeletion,
  releaseRemovalDeletionClaim,
  withReleasedDocumentMirrorLock,
  REMOVAL_DELETE_ALREADY_DELETING_ERROR,
  REMOVAL_DELETE_CHANGED_ERROR,
  REMOVAL_DELETE_IN_FLIGHT_ERROR,
  REMOVAL_DELETE_SUBMITTED_ERROR,
} from "@/data-access/certifier-removal-deletion";
import { deleteApplication } from "@/data-access/applications";
import { deleteDelivery } from "@/data-access/deliveries";
import { deleteRemoval } from "@/fn/certification/delete-removal";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_EXTERNAL_MUTATIONS,
} from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import { buildRemovalSupplierRef } from "@/lib/isometric/utils/supplier-ref";
import { buildCreateBiocharApplicationRequest } from "@/lib/isometric/biochar-applications";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import {
  createBiocharApplicationChain,
  type BiocharApplicationChain,
} from "./helpers/biochar-application-chain";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";
const RUN_ID_LENGTH = 8;
const SUBMISSION_VERSION = 1;
const createdFacilityIds: string[] = [];
const createdRemovalIds: string[] = [];
const createdBatchIds: string[] = [];
const createdFeedstockTypeIds: string[] = [];
const createdChains: BiocharApplicationChain[] = [];
const createdDocumentIds: string[] = [];
let registry: FakeIsometricRegistry;
beforeAll(async () => {
  await ensureTestOrg();
});
beforeEach(() => {
  registry = installFakeRegistry();
});
afterAll(async () => {
  if (createdDocumentIds.length > 0) {
    await db
      .delete(certifierDocumentUploads)
      .where(inArray(certifierDocumentUploads.documentId, createdDocumentIds));
    await db
      .delete(documents)
      .where(inArray(documents.id, createdDocumentIds));
  }
  for (const chain of createdChains.reverse()) {
    await db
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.applicationId, chain.applicationId));
    await db
      .delete(certifierBiocharApplications)
      .where(eq(certifierBiocharApplications.applicationId, chain.applicationId));
    await chain.cleanup();
  }
  if (createdBatchIds.length > 0) {
    await db
      .delete(creditBatches)
      .where(inArray(creditBatches.id, createdBatchIds));
  }
  if (createdRemovalIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, createdRemovalIds));
    await db
      .delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, createdRemovalIds));
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, createdRemovalIds));
  }
  if (createdFacilityIds.length > 0) {
    await db
      .delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, createdFacilityIds));
    await db
      .delete(certifierProjects)
      .where(inArray(certifierProjects.facilityId, createdFacilityIds));
    await db
      .delete(facilities)
      .where(inArray(facilities.id, createdFacilityIds));
  }
  if (createdFeedstockTypeIds.length > 0) {
    await db
      .delete(feedstockTypes)
      .where(inArray(feedstockTypes.id, createdFeedstockTypeIds));
  }
});
const createFixture = () => createRemovalDeletionFixture({
  createdFacilityIds, createdRemovalIds, createdBatchIds, createdFeedstockTypeIds,
});
async function insertRegistration(
  fixture: Fixture,
  chain: BiocharApplicationChain,
  args: {
    submissionId: string;
    supplierReference: string;
    externalApplicationId: string | null;
    lifecycleStatus: "creating" | "confirmed" | "deleted";
  },
): Promise<string> {
  const body = buildCreateBiocharApplicationRequest({
    applicationCode: `AP-${fixture.runId}`,
    applicationDate: "2026-04-05",
    applicationWetMassKg: 12_000,
    fieldSizeHa: 4,
    externalProjectId: fixture.externalProjectId,
    externalProductionBatchId: chain.externalProductionBatchId,
    externalStorageLocationId: chain.externalStorageLocationId,
    supplierReferenceId: args.supplierReference,
    sourceIds: [],
  });
  const [row] = await db
    .insert(certifierBiocharApplications)
    .values({
      organizationId: TEST_ORG_ID,
      applicationId: chain.applicationId,
      creditBatchId: fixture.creditBatchId,
      removalSubmissionId: args.submissionId,
      productionBatchRegistrationId: chain.productionBatchRegistrationId,
      storageLocationRegistrationId: chain.storageLocationRegistrationId,
      externalProductionBatchId: chain.externalProductionBatchId,
      externalStorageLocationId: chain.externalStorageLocationId,
      externalApplicationId: args.externalApplicationId,
      supplierReference: args.supplierReference,
      submittedPayload: body,
      payloadHash: payloadHash(body),
      lifecycleStatus: args.lifecycleStatus,
    })
    .returning({ id: certifierBiocharApplications.id });
  return row.id;
}
async function registrationRowsFor(submissionId: string) {
  return db
    .select({
      id: certifierBiocharApplications.id,
      lifecycleStatus: certifierBiocharApplications.lifecycleStatus,
    })
    .from(certifierBiocharApplications)
    .where(eq(certifierBiocharApplications.removalSubmissionId, submissionId));
}
function interruptedMetadata(): Record<string, unknown> {
  return {
    lastAttemptOutcome: SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
    externalMutation: SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
    lastError: "Creating Removal in Isometric failed",
  };
}
async function insertMirroredDocument(
  fixture: Fixture,
  args: { entityType: "application" | "delivery"; entityId: string; sourceId: string },
): Promise<string> {
  const [document] = await db
    .insert(documents)
    .values({
      organizationId: TEST_ORG_ID,
      entityType: args.entityType,
      entityId: args.entityId,
      documentType: "pdf",
      fileName: `${args.entityType}-${fixture.runId}.pdf`,
      fileUrl: `https://evidence.example.test/${args.entityType}-${fixture.runId}.pdf`,
    })
    .returning({ id: documents.id });
  createdDocumentIds.push(document.id);
  await db.insert(certifierDocumentUploads).values({
    organizationId: TEST_ORG_ID,
    documentId: document.id,
    provider: "isometric",
    externalDocumentId: args.sourceId,
  });
  return document.id;
}
async function syncEvents(
  fixture: Fixture,
  operation: string,
): Promise<Array<{ status: string; requestPayload: unknown }>> {
  return db
    .select({
      status: certifierSyncEvents.status,
      requestPayload: certifierSyncEvents.requestPayload,
    })
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityId, fixture.removalId),
        eq(certifierSyncEvents.organizationId, TEST_ORG_ID),
        eq(certifierSyncEvents.operation, operation),
      ),
    );
}
async function mirrorExists(documentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: certifierDocumentUploads.id })
    .from(certifierDocumentUploads)
    .where(eq(certifierDocumentUploads.documentId, documentId))
    .limit(1);
  return Boolean(row);
}
async function removalExists(removalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(eq(certifierRemovals.id, removalId))
    .limit(1);
  return Boolean(row);
}
async function ledgerRow(id: string) {
  const [row] = await db
    .select({
      status: certificationSubmissions.status,
      lockedAt: certificationSubmissions.lockedAt,
      metadata: certificationSubmissions.metadata,
      externalId: certificationSubmissions.externalId,
    })
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.id, id))
    .limit(1);
  return row;
}
describe("deleteRemoval", () => {
  it("deletes the draft GHG Entry, releases the reservation, and removes the Removal", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    const submissionId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
      reserveBatch: true,
    });
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.deletedGhgEntryIds).toEqual([entry.id]);
    expect(registry.ghgEntries).toHaveLength(0);
    expect(registry.requestCount("DELETE", `/ghg_entries/${entry.id}`)).toBe(1);
    expect(await removalExists(fixture.removalId)).toBe(false);
    const row = await ledgerRow(submissionId);
    expect(row.status).toBe("rejected");
    expect(row.lockedAt).toBeNull();
    expect(row.externalId).toBe(entry.id);
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.lastAttemptOutcome).toBeUndefined();
    expect(metadata.lastError).toBeUndefined();
    expect(metadata.deletion).toMatchObject({
      deletedGhgEntryIds: [entry.id],
      deletedBiocharApplicationIds: [],
    });
    const [batch] = await db
      .select({
        reserved: creditBatches.productionEmissionsClaimReservedBySubmissionId,
      })
      .from(creditBatches)
      .where(eq(creditBatches.id, fixture.creditBatchId));
    expect(batch.reserved).toBeNull();
    const events = await db
      .select({
        operation: certifierSyncEvents.operation,
        status: certifierSyncEvents.status,
      })
      .from(certifierSyncEvents)
      .where(
        and(
          eq(certifierSyncEvents.entityId, fixture.removalId),
          eq(certifierSyncEvents.organizationId, TEST_ORG_ID),
        ),
      );
    expect(events).toEqual(
      expect.arrayContaining([
        { operation: "removal:delete:ghg-entry", status: "succeeded" },
        { operation: "removal:delete", status: "succeeded" },
      ]),
    );
  });
  it.each([false, true])("cleans up owned uploads and retains a shared batch: %s", async (shared) => {
    const fixture = await createFixture();
    const chain = await createBiocharApplicationChain({
      tag: `DEL-${fixture.runId}`,
      facilityId: fixture.facilityId,
      creditBatchId: fixture.creditBatchId,
      certifierProjectId: fixture.certifierProjectId,
      externalProjectId: fixture.externalProjectId,
    });
    createdChains.push(chain);
    const batchReference = buildProductionBatchReference({
      creditBatchId: fixture.creditBatchId,
    });
    const externalFacilityId = `fcl_${fixture.runId}`;
    await db
      .update(certifierProductionBatches)
      .set({ supplierReference: batchReference, externalFacilityId })
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId));
    await db.insert(creditBatchApplications).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: fixture.creditBatchId,
      applicationId: chain.applicationId,
      removalId: fixture.removalId,
      allocatedWetMassKg: 12_000,
      allocatedDryMassKg: 10_800,
    });
    registry.productionBatches.push({
      id: chain.externalProductionBatchId,
      supplier_reference_id: batchReference,
      facility_id: externalFacilityId,
    });
    if (shared) {
      const otherRemoval = await createFixture();
      await insertLedgerRow(otherRemoval, {
        status: "draft",
        externalId: null,
        payloadSnapshot: { creditBatchIds: [fixture.creditBatchId] },
      });
    }
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    const submissionId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
    });
    const sampleId = `sample-${fixture.runId}`;
    const measurementReference = buildMeasurementSampleReference({
      removalId: fixture.removalId,
      version: SUBMISSION_VERSION,
      role: "production-batch",
      creditBatchId: fixture.creditBatchId,
      sampleId,
    });
    const measurementId = `mts_${fixture.runId}`;
    await db.update(certificationSubmissions).set({
      payloadSnapshot: {
        durabilityMeasurementSamples: { submissions: [{
          creditBatchId: fixture.creditBatchId,
          sampleId,
          supplierRefId: measurementReference,
          body: { supplier_reference_id: measurementReference },
        }] },
        journaled: { measurementSamples: [{
          supplierReferenceId: measurementReference,
          measurementSampleId: measurementId,
        }] },
      },
    }).where(eq(certificationSubmissions.id, submissionId));
    registry.measurementSamples.push({
      id: measurementId,
      supplier_reference_id: measurementReference,
      production_batch_id: chain.externalProductionBatchId,
    });
    const remoteApplication = registry.seedBiocharApplication({
      ghg_entry_id: entry.id,
    });
    const confirmedReference = `nm-isometric-sandbox-bca-${fixture.runId}-v1`;
    await insertRegistration(fixture, chain, {
      submissionId,
      supplierReference: confirmedReference,
      externalApplicationId: remoteApplication.id,
      lifecycleStatus: "confirmed",
    });
    // An earlier attempt's tombstoned registration on its own ledger version:
    // no registry call for it, but its row must go too.
    const priorSubmissionId = await insertLedgerRow(fixture, {
      status: "rejected",
      externalId: null,
      version: SUBMISSION_VERSION + 1,
      metadata: { lastError: "Creating Removal in Isometric failed" },
    });
    await insertRegistration(fixture, chain, {
      submissionId: priorSubmissionId,
      supplierReference: `nm-isometric-sandbox-bca-${fixture.runId}-s2-v1`,
      externalApplicationId: null,
      lifecycleStatus: "deleted",
    });
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.deletedGhgEntryIds).toEqual([entry.id]);
    expect(result.deletedBiocharApplicationIds).toEqual([remoteApplication.id]);
    expect(
      registry.requestCount("DELETE", `/biochar_applications/${remoteApplication.id}`),
    ).toBe(1);
    expect(registry.biocharApplications).toHaveLength(0);
    // The GHG Entry goes before its Applications.
    const deletes = registry.requests
      .filter((request) => request.method === "DELETE")
      .map((request) => request.path);
    expect(deletes).toEqual([
      `/ghg_entries/${entry.id}`,
      `/biochar_applications/${remoteApplication.id}`,
      `/measurement_samples/${measurementId}`,
      ...(shared ? [] : [`/production_batches/${chain.externalProductionBatchId}`]),
    ]);
    expect(registry.measurementSamples).toHaveLength(0);
    expect(registry.productionBatches).toHaveLength(shared ? 1 : 0);
    expect(await db.select().from(certifierProductionBatches)
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId)))
      .toHaveLength(shared ? 1 : 0);
    expect(await db.select({ id: creditBatches.id }).from(creditBatches)
      .where(eq(creditBatches.id, fixture.creditBatchId)))
      .toEqual([{ id: fixture.creditBatchId }]);
    // Rows are removed, not tombstoned, so the supplier reference is free.
    expect(await registrationRowsFor(submissionId)).toEqual([]);
    expect(await registrationRowsFor(priorSubmissionId)).toEqual([]);
    expect(await removalExists(fixture.removalId)).toBe(false);
    const row = await ledgerRow(submissionId);
    expect((row.metadata as { deletion: unknown }).deletion).toMatchObject({
      deletedBiocharApplicationIds: [remoteApplication.id],
    });
  });
  it("releases the evidence mirrors only the deleted submission cited, so the Application and Delivery can be deleted", async () => {
    const fixture = await createFixture();
    const chain = await createBiocharApplicationChain({
      tag: fixture.runId,
      facilityId: fixture.facilityId,
      creditBatchId: fixture.creditBatchId,
      certifierProjectId: fixture.certifierProjectId,
      externalProjectId: fixture.externalProjectId,
    });
    createdChains.push(chain);
    const [application] = await db
      .select({ deliveryId: applications.deliveryId })
      .from(applications)
      .where(eq(applications.id, chain.applicationId));
    const applicationSourceId = registry.seedSource().id;
    const deliverySourceId = registry.seedSource().id;
    const applicationDocumentId = await insertMirroredDocument(fixture, {
      entityType: "application",
      entityId: chain.applicationId,
      sourceId: applicationSourceId,
    });
    const deliveryDocumentId = await insertMirroredDocument(fixture, {
      entityType: "delivery",
      entityId: application.deliveryId!,
      sourceId: deliverySourceId,
    });
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    const submissionId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
      payloadSnapshot: {
        sourceBindingPlan: [{ sourceId: deliverySourceId }],
        transport: {
          biocharApplicationIntents: [{ sourceIds: [applicationSourceId] }],
        },
      },
    });
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.releasedDocumentMirrorCount).toBe(2);
    expect(await mirrorExists(applicationDocumentId)).toBe(false);
    expect(await mirrorExists(deliveryDocumentId)).toBe(false);
    // The released Sources go too, after the local cleanup committed.
    expect(result.deletedSourceIds).toEqual(
      expect.arrayContaining([applicationSourceId, deliverySourceId]),
    );
    expect(registry.sources).toHaveLength(0);
    expect(registry.requestCount("DELETE", `/sources/${applicationSourceId}`)).toBe(1);
    expect(registry.requestCount("DELETE", `/sources/${deliverySourceId}`)).toBe(1);
    const sourceEvents = await syncEvents(fixture, "removal:delete:source");
    expect(sourceEvents).toEqual(
      expect.arrayContaining([
        { status: "succeeded", requestPayload: { id: applicationSourceId } },
        { status: "succeeded", requestPayload: { id: deliverySourceId } },
      ]),
    );
    const metadata = (await ledgerRow(submissionId)).metadata as {
      deletion: { releasedDocumentMirrors: unknown[] };
    };
    expect(metadata.deletion.releasedDocumentMirrors).toEqual(
      expect.arrayContaining([
        { documentId: applicationDocumentId, externalDocumentId: applicationSourceId },
        { documentId: deliveryDocumentId, externalDocumentId: deliverySourceId },
      ]),
    );
    const ctx = makeTestOrgContext();
    await expect(deleteApplication(ctx, chain.applicationId)).resolves.toBeUndefined();
    await expect(deleteDelivery(ctx, application.deliveryId!)).resolves.toBeUndefined();
    expect(
      await db
        .select({ id: documents.id })
        .from(documents)
        .where(inArray(documents.id, [applicationDocumentId, deliveryDocumentId])),
    ).toHaveLength(0);
  });
  it("keeps a mirror that a live submission of another Removal still cites", async () => {
    const fixture = await createFixture();
    const other = await createFixture();
    const chain = await createBiocharApplicationChain({
      tag: fixture.runId,
      facilityId: fixture.facilityId,
      creditBatchId: fixture.creditBatchId,
      certifierProjectId: fixture.certifierProjectId,
      externalProjectId: fixture.externalProjectId,
    });
    createdChains.push(chain);
    const sharedSourceId = registry.seedSource().id;
    const documentId = await insertMirroredDocument(fixture, {
      entityType: "application",
      entityId: chain.applicationId,
      sourceId: sharedSourceId,
    });
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
      payloadSnapshot: { sourceBindingPlan: [{ sourceId: sharedSourceId }] },
    });
    await insertLedgerRow(other, {
      status: "rejected",
      externalId: null,
      payloadSnapshot: { sourceBindingPlan: [{ sourceId: sharedSourceId }] },
    });
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.releasedDocumentMirrorCount).toBe(0);
    expect(result.deletedSourceIds).toEqual([]);
    expect(await mirrorExists(documentId)).toBe(true);
    expect(registry.sources).toHaveLength(1);
    expect(registry.requestCount("DELETE", `/sources/${sharedSourceId}`)).toBe(0);
    await expect(
      deleteApplication(makeTestOrgContext(), chain.applicationId),
    ).rejects.toThrow(/certification provider/);
  });

  it("completes the deletion and records the refusal when the registry keeps a released Source", async () => {
    const fixture = await createFixture();
    const chain = await createBiocharApplicationChain({
      tag: fixture.runId,
      facilityId: fixture.facilityId,
      creditBatchId: fixture.creditBatchId,
      certifierProjectId: fixture.certifierProjectId,
      externalProjectId: fixture.externalProjectId,
    });
    createdChains.push(chain);
    const refusedSourceId = registry.seedSource().id;
    const absentSourceId = `src_absent_${fixture.runId}`;
    const refusedDocumentId = await insertMirroredDocument(fixture, {
      entityType: "application",
      entityId: chain.applicationId,
      sourceId: refusedSourceId,
    });
    const absentDocumentId = await insertMirroredDocument(fixture, {
      entityType: "application",
      entityId: chain.applicationId,
      sourceId: absentSourceId,
    });
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
      payloadSnapshot: {
        sourceBindingPlan: [{ sourceId: refusedSourceId }, { sourceId: absentSourceId }],
      },
    });
    registry.failNext(`DELETE /sources/${refusedSourceId}`, "reject-before-commit", {
      status: 422,
      body: { errors: [{ detail: "Source is referenced by a locked datapoint" }] },
    });

    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });

    expect(result.releasedDocumentMirrorCount).toBe(2);
    expect(result.deletedSourceIds).toEqual([]);
    expect(await removalExists(fixture.removalId)).toBe(false);
    expect(await mirrorExists(refusedDocumentId)).toBe(false);
    expect(await mirrorExists(absentDocumentId)).toBe(false);
    expect(registry.sources.map((source) => source.id)).toEqual([refusedSourceId]);
    expect(registry.requestCount("DELETE", `/sources/${absentSourceId}`)).toBe(1);
    const sourceEvents = await syncEvents(fixture, "removal:delete:source");
    expect(sourceEvents).toEqual(
      expect.arrayContaining([
        { status: "failed", requestPayload: { id: refusedSourceId } },
        { status: "succeeded", requestPayload: { id: absentSourceId } },
      ]),
    );
    const [refusal] = await db
      .select({ errorMessage: certifierSyncEvents.errorMessage })
      .from(certifierSyncEvents)
      .where(
        and(
          eq(certifierSyncEvents.entityId, fixture.removalId),
          eq(certifierSyncEvents.operation, "removal:delete:source"),
          eq(certifierSyncEvents.status, "failed"),
        ),
      );
    expect(refusal.errorMessage).toMatch(/locked datapoint.*Source stays on the registry/);
  });

  it("retains a released Source that was mirrored again before its delete", async () => {
    const fixture = await createFixture();
    const chain = await createBiocharApplicationChain({
      tag: fixture.runId,
      facilityId: fixture.facilityId,
      creditBatchId: fixture.creditBatchId,
      certifierProjectId: fixture.certifierProjectId,
      externalProjectId: fixture.externalProjectId,
    });
    createdChains.push(chain);
    const source = registry.seedSource();
    const documentId = await insertMirroredDocument(fixture, {
      entityType: "application",
      entityId: chain.applicationId,
      sourceId: source.id,
    });
    const ctx = makeTestOrgContext();

    // A mirror that reconciled onto the Source holds the mapping again.
    const run = vi.fn(async () => "deleted" as const);
    await expect(
      withReleasedDocumentMirrorLock(ctx, documentId, run),
    ).resolves.toBe("retained");
    expect(run).not.toHaveBeenCalled();

    // With the mapping gone the fenced call runs and its outcome is returned.
    await db
      .delete(certifierDocumentUploads)
      .where(eq(certifierDocumentUploads.documentId, documentId));
    await expect(
      withReleasedDocumentMirrorLock(ctx, documentId, run),
    ).resolves.toBe("deleted");
    expect(run).toHaveBeenCalledOnce();
  });
  it("removes a Removal with no ledger without touching the registry", async () => {
    const fixture = await createFixture();
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.deletedGhgEntryIds).toEqual([]);
    expect(registry.requests).toHaveLength(0);
    expect(await removalExists(fixture.removalId)).toBe(false);
  });
  it("lets any member delete, registry cleanup included", async () => {
    const member = { ...makeTestOrgContext(), orgRole: "member" as const };
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
    });
    const result = await deleteRemoval(member, {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.deletedGhgEntryIds).toEqual([entry.id]);
    expect(registry.ghgEntries).toHaveLength(0);
    expect(await removalExists(fixture.removalId)).toBe(false);
  });
  it("finds and deletes a GHG Entry whose POST landed without a recorded ID", async () => {
    const fixture = await createFixture();
    const supplierRef = buildRemovalSupplierRef({
      removalId: fixture.removalId,
      role: "removal",
      version: SUBMISSION_VERSION,
    });
    const entry = registry.seedGhgEntry({
      status: "DRAFT",
      supplier_reference_id: supplierRef,
    });
    await insertLedgerRow(fixture, {
      status: "rejected",
      externalId: null,
      metadata: { lastError: "Removal POST failed: response lost" },
    });
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    expect(result.deletedGhgEntryIds).toEqual([entry.id]);
    expect(registry.ghgEntries).toHaveLength(0);
    expect(await removalExists(fixture.removalId)).toBe(false);
  });
  it("treats an already-deleted GHG Entry as absent and still completes", async () => {
    const fixture = await createFixture();
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: `gge_gone_${fixture.removalId.slice(0, RUN_ID_LENGTH)}`,
      metadata: interruptedMetadata(),
    });
    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });

    expect(result.deletedGhgEntryIds).toEqual([]);
    expect(await removalExists(fixture.removalId)).toBe(false);
    const [audit] = await db
      .select({ metadata: certificationSubmissions.metadata })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.localEntityId, fixture.removalId));
    expect((audit.metadata as { deletion: unknown }).deletion).toMatchObject({
      deletedGhgEntryIds: [],
      absentGhgEntryIds: [`gge_gone_${fixture.removalId.slice(0, RUN_ID_LENGTH)}`],
    });
  });

  it("refuses to finalize when a submission ran between claim and finalize", async () => {
    // Only a rejected row: the claim re-locks nothing, so the window between
    // the two transactions is open. A submit that claims a new draft in that
    // window must keep the Removal.
    const fixture = await createFixture();
    const rejectedId = await insertLedgerRow(fixture, {
      status: "rejected",
      externalId: null,
      metadata: { lastError: "Creating Removal in Isometric failed" },
    });
    const ctx = makeTestOrgContext();
    const claim = await claimRemovalDeletion(
      ctx,
      fixture.facilityId,
      fixture.removalId,
    );
    expect(claim.submissionIds).toEqual([rejectedId]);
    expect(claim.lockedSubmissions).toEqual([
      { id: rejectedId, priorLockedAt: null, priorAttemptOutcome: null },
    ]);
    // The rejected row now carries the deletion lock so a submit cannot
    // resume it while the registry cleanup runs.
    const lockedRow = await ledgerRow(rejectedId);
    expect(lockedRow.status).toBe("rejected");
    expect(lockedRow.lockedAt?.getTime()).toBe(claim.lockedAt.getTime());
    expect((lockedRow.metadata as Record<string, unknown>).lastAttemptOutcome).toBe(
      SUBMISSION_ATTEMPT_OUTCOMES.deleting,
    );

    const concurrentDraftId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: null,
      lockedAt: new Date(),
      version: SUBMISSION_VERSION + 1,
    });

    await expect(
      finalizeRemovalDeletion(ctx, claim, {
        deletedGhgEntryIds: [],
        deletedBiocharApplicationIds: [],
        absentGhgEntryIds: [],
        absentBiocharApplicationIds: [],
        unresolvedBiocharApplicationReferences: [],
      }),
    ).rejects.toThrow(REMOVAL_DELETE_CHANGED_ERROR);
    expect(await removalExists(fixture.removalId)).toBe(true);
    expect((await ledgerRow(concurrentDraftId)).status).toBe("draft");
    expect((await ledgerRow(rejectedId)).status).toBe("rejected");
  });

  it("refuses a second deletion claim while the first still holds rejected rows", async () => {
    const fixture = await createFixture();
    const rejectedId = await insertLedgerRow(fixture, {
      status: "rejected",
      externalId: null,
      metadata: { lastError: "Creating Removal in Isometric failed" },
    });
    const ctx = makeTestOrgContext();
    const first = await claimRemovalDeletion(
      ctx,
      fixture.facilityId,
      fixture.removalId,
    );

    await expect(
      claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId),
    ).rejects.toThrow(REMOVAL_DELETE_ALREADY_DELETING_ERROR);
    expect((await ledgerRow(rejectedId)).lockedAt?.getTime()).toBe(
      first.lockedAt.getTime(),
    );

    await releaseRemovalDeletionClaim(ctx, first);
    const released = await ledgerRow(rejectedId);
    expect(released.lockedAt).toBeNull();
    expect(
      (released.metadata as Record<string, unknown>).lastAttemptOutcome,
    ).toBeUndefined();
  });

  it("refuses a submitted Removal and leaves everything in place", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    await insertLedgerRow(fixture, { status: "submitted", externalId: entry.id });

    await expect(
      deleteRemoval(makeTestOrgContext(), {
        facilityId: fixture.facilityId,
        removalId: fixture.removalId,
      }),
    ).rejects.toThrow(REMOVAL_DELETE_SUBMITTED_ERROR);

    expect(registry.requests).toHaveLength(0);
    expect(registry.ghgEntries).toHaveLength(1);
    expect(await removalExists(fixture.removalId)).toBe(true);
  });

  it("refuses while a submission attempt still holds its lock", async () => {
    const fixture = await createFixture();
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: null,
      lockedAt: new Date(),
      metadata: null,
    });

    await expect(
      deleteRemoval(makeTestOrgContext(), {
        facilityId: fixture.facilityId,
        removalId: fixture.removalId,
      }),
    ).rejects.toThrow(REMOVAL_DELETE_IN_FLIGHT_ERROR);
    expect(await removalExists(fixture.removalId)).toBe(true);
  });

  it("releases the claim and keeps the Removal when the registry refuses the delete", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "AWAITING_VERIFICATION" });
    const submissionId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
    });
    registry.failNext(`DELETE /ghg_entries/${entry.id}`, "reject-before-commit", {
      status: 422,
      body: { errors: [{ detail: "GHG entry is not in DRAFT status" }] },
    });

    const attempt = deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    await expect(attempt).rejects.toThrow(/not in DRAFT status/);

    expect(registry.ghgEntries).toHaveLength(1);
    expect(await removalExists(fixture.removalId)).toBe(true);
    const row = await ledgerRow(submissionId);
    expect(row.status).toBe("draft");
    expect(row.lockedAt).toBeNull();
    expect((row.metadata as Record<string, unknown>).lastAttemptOutcome).toBe(
      SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
    );

    const [failure] = await db
      .select({ status: certifierSyncEvents.status })
      .from(certifierSyncEvents)
      .where(
        and(
          eq(certifierSyncEvents.entityId, fixture.removalId),
          eq(certifierSyncEvents.operation, "removal:delete:ghg-entry"),
        ),
      );
    expect(failure.status).toBe("failed");
  });
});


describe("ledger-free deletion lease", () => {
  it.each(["release", "expire"])("blocks concurrent work, then permits it after %s", async (mode) => {
    const fixture = await createFixture();
    const ctx = makeTestOrgContext();
    const chain = await createBiocharApplicationChain({ ...fixture, tag: `LEASE-${fixture.runId}` });
    createdChains.push(chain);
    await db.update(certifierProductionBatches).set({ supplierReference: buildProductionBatchReference({ creditBatchId: fixture.creditBatchId }) })
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId));
    await db.insert(creditBatchApplications).values({ organizationId: TEST_ORG_ID, creditBatchId: fixture.creditBatchId,
      applicationId: chain.applicationId, removalId: fixture.removalId, allocatedWetMassKg: 12_000, allocatedDryMassKg: 10_800 });
    const submit = () => claimSubmissionDraft(ctx, {
      key: { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId },
      guard: { facilityId: fixture.facilityId, provider: "isometric", expectedExternalProjectId: fixture.externalProjectId },
      policy: { onSubmittedHashChanged: "supersede" }, tentativeInputs: {}, hashOf: () => "lease-test",
      buildSnapshot: () => ({ payloadSnapshot: {} }),
    });
    const claims = await Promise.allSettled([claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId),
      claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId)]);
    expect(claims.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = claims.find((result) => result.status === "fulfilled");
    if (!winner || winner.status !== "fulfilled") throw new Error("No deletion winner");
    const claim = winner.value;
    expect(claim.submissionIds).toEqual([]);
    expect(claim.productionBatches).toHaveLength(1);
    await expect(createRemovalWithCreditBatches(ctx, fixture.facilityId, [fixture.creditBatchId])).rejects.toThrow("being deleted");
    await expect(submit()).resolves.toMatchObject({ kind: "blocked", reason: "in-flight" });
    await expect(discardLocalRemovalDraft(ctx, fixture.facilityId, fixture.removalId)).rejects.toThrow();
    if (mode === "release") await releaseRemovalDeletionClaim(ctx, claim);
    else {
      const expiredAt = new Date(Date.now() - LOCK_TTL_MS - 1);
      await db.update(certifierRemovals).set({ metadata: { [REMOVAL_DELETION_LEASE_KEY]: expiredAt.toISOString() } })
        .where(eq(certifierRemovals.id, fixture.removalId));
      const oldClaim = { ...claim, lockedAt: expiredAt };
      const reclaimed = await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
      await releaseRemovalDeletionClaim(ctx, oldClaim);
      await expect(finalizeRemovalDeletion(ctx, oldClaim, { deletedGhgEntryIds: [], deletedBiocharApplicationIds: [],
        absentGhgEntryIds: [], absentBiocharApplicationIds: [], unresolvedBiocharApplicationReferences: [] })).rejects.toThrow(REMOVAL_DELETE_CHANGED_ERROR);
      await expect(submit()).resolves.toMatchObject({ kind: "blocked" });
      await db.update(certifierRemovals).set({ metadata: { [REMOVAL_DELETION_LEASE_KEY]: expiredAt.toISOString() } })
        .where(eq(certifierRemovals.id, fixture.removalId));
      expect(reclaimed.lockedAt.getTime()).toBeGreaterThan(oldClaim.lockedAt.getTime());
    }
    await db.transaction(async (tx) => {
      await tx.select({ id: creditBatches.id }).from(creditBatches).where(eq(creditBatches.id, fixture.creditBatchId)).for("update");
      await expect(assertNoRemovalBatchDeletion(ctx, [fixture.creditBatchId], tx)).resolves.toBeUndefined();
    });
    await expect(submit()).resolves.toMatchObject({ kind: "claimed", resumed: false });
  });
});


it.each([false, true])("rechecks the lease after the optimistic submission read (resume=%s)", async (resume) => {
  const fixture = await createFixture();
  const ctx = makeTestOrgContext();
  if (resume) {
    const id = await insertLedgerRow(fixture, { status: "rejected", externalId: null });
    await db.update(certificationSubmissions).set({ payloadHash: "lease-race" }).where(eq(certificationSubmissions.id, id));
  }
  let signalRead!: () => void;
  let releaseMapping!: () => void;
  let signalMapping!: () => void;
  const read = new Promise<void>((resolve) => { signalRead = resolve; });
  const release = new Promise<void>((resolve) => { releaseMapping = resolve; });
  const mapping = new Promise<void>((resolve) => { signalMapping = resolve; });
  const holder = db.transaction(async (tx) => {
    await tx.select({ id: certifierProjects.id }).from(certifierProjects)
      .where(eq(certifierProjects.id, fixture.certifierProjectId)).for("update");
    signalMapping();
    await release;
  });
  await mapping;
  const submission = claimSubmissionDraft(ctx, {
    key: { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId },
    guard: { facilityId: fixture.facilityId, provider: "isometric", expectedExternalProjectId: fixture.externalProjectId },
    policy: { onSubmittedHashChanged: "supersede" }, tentativeInputs: {},
    hashOf: () => { signalRead(); return "lease-race"; }, buildSnapshot: () => ({ payloadSnapshot: {} }),
  });
  try {
    await read;
    await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
  } finally { releaseMapping(); }
  await holder;
  await expect(submission).resolves.toMatchObject({ kind: "blocked", reason: "in-flight" });
});


it("serializes concurrent retained-batch finalizers and preserves the last Removal for retry", async () => {
  const first = await createFixture();
  const [other] = await db.insert(certifierRemovals).values({
    organizationId: TEST_ORG_ID, facilityId: first.facilityId, provider: "isometric",
  }).returning({ id: certifierRemovals.id });
  createdRemovalIds.push(other.id);
  const fixtures = [first, { ...first, removalId: other.id }];
  const chain = await createBiocharApplicationChain({ ...first, tag: first.runId });
  createdChains.push(chain);
  await db.update(certifierProductionBatches).set({
    supplierReference: buildProductionBatchReference({ creditBatchId: first.creditBatchId }),
  }).where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId));
  // Separate application slices in the same batch belong to the two Removals.
  const [application] = await db.select().from(applications).where(eq(applications.id, chain.applicationId));
  const [secondApplication] = await db.insert(applications).values({
    ...application, id: crypto.randomUUID(), code: `AP-RACE-${first.runId}`,
  }).returning({ id: applications.id });
  try {
    for (const [index, fixture] of fixtures.entries()) {
      await db.insert(creditBatchApplications).values({
        organizationId: TEST_ORG_ID, creditBatchId: first.creditBatchId,
        applicationId: index === 0 ? chain.applicationId : secondApplication.id,
        removalId: fixture.removalId, allocatedWetMassKg: 12_000, allocatedDryMassKg: 10_800,
      });
      await insertLedgerRow(fixture, { status: "rejected", externalId: null });
    }
    const ctx = makeTestOrgContext();
    const claims = await Promise.all(fixtures.map((fixture) =>
      claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId)));
    const outcomes = claims.map((claim) => ({
      deletedGhgEntryIds: [], deletedBiocharApplicationIds: [], absentGhgEntryIds: [],
      absentBiocharApplicationIds: [], unresolvedBiocharApplicationReferences: [],
      productionBatches: claim.productionBatches!.map((target) => ({
        creditBatchId: target.creditBatchId, externalId: target.externalProductionBatchId,
        outcome: "retained" as const,
      })),
    }));
    for (const claim of claims) {
      expect(await isRemovalProductionBatchShared(ctx, claim, claim.productionBatches![0])).toBe(true);
    }
    const journals = await Promise.all(claims.map((claim) => ledgerRow(claim.submissionIds[0])));
    let unlock!: () => void;
    let locked!: (pid: number) => void;
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<number>((resolve) => { locked = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(eq(creditBatches.id, first.creditBatchId)).for("update");
      const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked(result.rows[0].pid);
      await release;
    });
    const pid = await ready;
    const finalizers = Promise.allSettled(claims.map((claim, index) =>
      finalizeRemovalDeletion(ctx, claim, outcomes[index])));
    try {
      // Both real transactions must reach the shared batch lock before either proceeds.
      await expect.poll(async () => {
        const result = await db.execute<{ count: number }>(sql`
          with recursive waiters(pid) as (
            select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
            union
            select activity.pid from pg_stat_activity activity
            join waiters on waiters.pid = any(pg_blocking_pids(activity.pid))
          )
          select count(*)::int as count from waiters
        `);
        return result.rows[0].count;
      }).toBe(2);
    } finally {
      unlock();
      await holder;
    }
    const results = await finalizers;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.findIndex((result) => result.status === "rejected");
    expect(results[loser]).toMatchObject({ reason: expect.any(SafeError) });
    expect((results[loser] as PromiseRejectedResult).reason.message).toContain("Run Delete Removal again");
    const claim = claims[loser];
    expect(await removalExists(claim.removalId)).toBe(true);
    expect(await db.select().from(creditBatchApplications)
      .where(eq(creditBatchApplications.removalId, claim.removalId))).toHaveLength(1);
    expect(await ledgerRow(claim.submissionIds[0])).toEqual(journals[loser]);
    expect(await db.select().from(certifierProductionBatches)
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId))).toHaveLength(1);
    await releaseRemovalDeletionClaim(ctx, claim);
    // The normal retry discovers the now-unshared registry batch and completes cleanup.
    await deleteRemoval(ctx, { facilityId: first.facilityId, removalId: claim.removalId });
    expect(await removalExists(claim.removalId)).toBe(false);
    expect(await db.select().from(certifierProductionBatches)
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId))).toHaveLength(0);
  } finally {
    await db.delete(creditBatchApplications).where(eq(creditBatchApplications.applicationId, secondApplication.id));
    await db.delete(applications).where(eq(applications.id, secondApplication.id));
  }
});
