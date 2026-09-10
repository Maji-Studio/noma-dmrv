import { createRemovalDeletionFixture, insertLedgerRow, type Fixture } from "./helpers/removal-deletion-fixture";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";
/**
 * DB-backed tests for the evidence side of deleting a never-finalized
 * Removal: the local Source mappings the deletion releases and the remote
 * Sources it deletes afterwards (`src/fn/certification/delete-removal.ts`
 * over `src/data-access/certifier-removal-deletion.ts`).
 *
 * Real Postgres for the finalize seam and the mirror-lock fence, the fake
 * registry (`tests/fixtures/fake-registry.ts`) for the DELETE calls. The
 * GHG Entry and Biochar Application side lives in `removal-deletion.test.ts`.
 *
 * Requires a real Postgres (`.env.test`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
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
import { applications } from "@/db/schema/application";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { withReleasedDocumentMirrorLock } from "@/data-access/certifier-removal-deletion";
import { deleteApplication } from "@/data-access/applications";
import { deleteDelivery } from "@/data-access/deliveries";
import { deleteRemoval } from "@/fn/certification/delete-removal";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_EXTERNAL_MUTATIONS,
} from "@/lib/certification/submission-metadata";
import { acquireMirrorLock } from "@/lib/isometric/utils/source-lock";
import {
  createBiocharApplicationChain,
  type BiocharApplicationChain,
} from "./helpers/biochar-application-chain";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";
const LOCK_WAIT_MS = 100;
const tracked = {
  createdFacilityIds: [] as string[],
  createdRemovalIds: [] as string[],
  createdBatchIds: [] as string[],
  createdFeedstockTypeIds: [] as string[],
};
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
  if (tracked.createdBatchIds.length > 0) {
    await db
      .delete(creditBatches)
      .where(inArray(creditBatches.id, tracked.createdBatchIds));
  }
  if (tracked.createdRemovalIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, tracked.createdRemovalIds));
    await db
      .delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, tracked.createdRemovalIds));
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, tracked.createdRemovalIds));
  }
  if (tracked.createdFacilityIds.length > 0) {
    await db
      .delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, tracked.createdFacilityIds));
    await db
      .delete(certifierProjects)
      .where(inArray(certifierProjects.facilityId, tracked.createdFacilityIds));
    await db
      .delete(facilities)
      .where(inArray(facilities.id, tracked.createdFacilityIds));
  }
  if (tracked.createdFeedstockTypeIds.length > 0) {
    await db
      .delete(feedstockTypes)
      .where(inArray(feedstockTypes.id, tracked.createdFeedstockTypeIds));
  }
});
const createFixture = () => createRemovalDeletionFixture(tracked);
async function createChain(fixture: Fixture): Promise<BiocharApplicationChain> {
  const chain = await createBiocharApplicationChain({
    tag: fixture.runId,
    facilityId: fixture.facilityId,
    creditBatchId: fixture.creditBatchId,
    certifierProjectId: fixture.certifierProjectId,
    externalProjectId: fixture.externalProjectId,
  });
  createdChains.push(chain);
  return chain;
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
    .select({ metadata: certificationSubmissions.metadata })
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.id, id))
    .limit(1);
  return row;
}
describe("deleteRemoval evidence cleanup", () => {
  it("releases the evidence mirrors only the deleted submission cited, so the Application and Delivery can be deleted", async () => {
    const fixture = await createFixture();
    const chain = await createChain(fixture);
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
    const chain = await createChain(fixture);
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
    const chain = await createChain(fixture);
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
    const chain = await createChain(fixture);
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
  it("waits for a concurrent mirror holding the document lock and retains the Source it mapped", async () => {
    const fixture = await createFixture();
    const chain = await createChain(fixture);
    const source = registry.seedSource();
    const documentId = await insertMirroredDocument(fixture, {
      entityType: "application",
      entityId: chain.applicationId,
      sourceId: source.id,
    });
    // The released state: the mapping is gone, the remote Source is not.
    await db
      .delete(certifierDocumentUploads)
      .where(eq(certifierDocumentUploads.documentId, documentId));
    const ctx = makeTestOrgContext();
    let signalLocked!: () => void;
    let releaseHolder!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseHolder = resolve; });
    // A mirror of the same document reconciles onto the Source under the lock.
    const holder = db.transaction(async (tx) => {
      await acquireMirrorLock(tx, documentId);
      signalLocked();
      await release;
      await tx.insert(certifierDocumentUploads).values({
        organizationId: TEST_ORG_ID,
        documentId,
        provider: "isometric",
        externalDocumentId: source.id,
      });
    });
    await locked;
    const run = vi.fn(async () => "deleted" as const);
    const fenced = withReleasedDocumentMirrorLock(ctx, documentId, run);
    // The fence must queue behind the holder, not decide before it commits.
    await Promise.race([
      fenced.then(() => { throw new Error("fence did not wait for the mirror lock"); }),
      new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS)),
    ]);
    releaseHolder();
    await holder;
    await expect(fenced).resolves.toBe("retained");
    expect(run).not.toHaveBeenCalled();
    expect(await mirrorExists(documentId)).toBe(true);
  });
});
