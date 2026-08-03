import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierDocumentUploads,
  certifierRemovals,
  documents,
  facilities,
  storageObjectDeletions,
} from "@/db/schema";
import { deleteDocumentWithCertificationSafety } from "@/data-access/documents";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { __setStorageProviderForTests } from "@/lib/storage";
import type {
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from "@/lib/storage";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "document-certification-history-user";

class DeleteSafetyStorageProvider implements StorageProvider {
  readonly name = "local-fs" as const;
  readonly bucket = "local-fs";
  readonly objects = new Set<string>();
  readonly deleteCalls: string[] = [];
  failKey: string | null = null;

  async createUploadUrl(): Promise<PresignedUpload> {
    throw new Error("Not used by document deletion tests");
  }

  async createDownloadUrl(): Promise<string> {
    throw new Error("Not used by document deletion tests");
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    return this.objects.has(key)
      ? { size: 1, contentType: "application/pdf", etag: "test" }
      : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.deleteCalls.push(key);
    if (key === this.failKey) throw new Error("Injected storage failure");
    this.objects.delete(key);
  }

  async putObject(key: string): Promise<void> {
    this.objects.add(key);
  }
}

let provider: DeleteSafetyStorageProvider;

beforeAll(() => ensureTestOrg());

beforeEach(() => {
  provider = new DeleteSafetyStorageProvider();
  __setStorageProviderForTests(provider);
});

afterEach(() => {
  __setStorageProviderForTests(null);
});

async function createFixture(tag: string) {
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FAC-DEL-SRC-${tag}`,
      name: `Document source deletion facility ${tag}`,
    })
    .returning({ id: facilities.id });
  const [removal] = await db
    .insert(certifierRemovals)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      provider: "isometric",
    })
    .returning({ id: certifierRemovals.id });
  const storageKey = `facility/${facility.id}/pdf/${tag}.pdf`;
  provider.objects.add(storageKey);
  const [document] = await db
    .insert(documents)
    .values({
      organizationId: TEST_ORG_ID,
      entityType: "facility",
      entityId: facility.id,
      documentType: "pdf",
      storageProvider: "local-fs",
      storageBucket: "local-fs",
      storageKey,
      fileName: "certification-evidence.pdf",
    })
    .returning({ id: documents.id });
  const externalDocumentId = `src_delete_${tag}`;
  await db.insert(certifierDocumentUploads).values({
    organizationId: TEST_ORG_ID,
    documentId: document.id,
    provider: "isometric",
    externalDocumentId,
  });
  return {
    facilityId: facility.id,
    removalId: removal.id,
    documentId: document.id,
    storageKey,
    externalDocumentId,
  };
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await db
    .delete(storageObjectDeletions)
    .where(eq(storageObjectDeletions.storageKey, fixture.storageKey));
  await db
    .delete(certificationSubmissions)
    .where(eq(certificationSubmissions.localEntityId, fixture.removalId));
  await db
    .delete(certifierDocumentUploads)
    .where(eq(certifierDocumentUploads.documentId, fixture.documentId));
  await db.delete(documents).where(eq(documents.id, fixture.documentId));
  await db
    .delete(certifierRemovals)
    .where(eq(certifierRemovals.id, fixture.removalId));
  await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
}

describe("owning-document certification safety", () => {
  it("retires an unreferenced local mapping while deleting draft evidence", async () => {
    const fixture = await createFixture(crypto.randomUUID().slice(0, 8));

    try {
      const deleted = await deleteDocumentWithCertificationSafety(
        makeTestOrgContext(TEST_USER_ID),
        fixture.documentId,
      );

      expect(deleted?.id).toBe(fixture.documentId);
      expect(provider.deleteCalls).toEqual([fixture.storageKey]);
      expect(provider.objects.has(fixture.storageKey)).toBe(false);
      expect(
        await db
          .select()
          .from(certifierDocumentUploads)
          .where(eq(certifierDocumentUploads.documentId, fixture.documentId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(documents)
          .where(eq(documents.id, fixture.documentId)),
      ).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("commits document retirement while a failed object deletion stays retryable", async () => {
    const fixture = await createFixture(crypto.randomUUID().slice(0, 8));
    provider.failKey = fixture.storageKey;

    try {
      const deleted = await deleteDocumentWithCertificationSafety(
        makeTestOrgContext(TEST_USER_ID),
        fixture.documentId,
      );

      expect(deleted?.id).toBe(fixture.documentId);
      expect(provider.objects.has(fixture.storageKey)).toBe(true);
      expect(
        await db
          .select()
          .from(documents)
          .where(eq(documents.id, fixture.documentId)),
      ).toHaveLength(0);
      const [pending] = await db
        .select()
        .from(storageObjectDeletions)
        .where(eq(storageObjectDeletions.storageKey, fixture.storageKey));
      expect(pending).toMatchObject({
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: "storage_delete_failed",
      });

      provider.failKey = null;
      expect(
        await processPendingStorageObjectDeletions(
          makeTestOrgContext(TEST_USER_ID),
        ),
      ).toEqual({ completed: 1, failed: 0 });
      expect(provider.objects.has(fixture.storageKey)).toBe(false);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("refuses deletion when a persisted submission snapshot references the Source", async () => {
    const fixture = await createFixture(crypto.randomUUID().slice(0, 8));
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: fixture.removalId,
      version: 1,
      status: "submitted",
      payloadSnapshot: {
        transport: {
          datapointBodies: [
            {
              body: {
                source_ids: [fixture.externalDocumentId],
              },
            },
          ],
        },
      },
    });

    try {
      await expect(
        deleteDocumentWithCertificationSafety(
          makeTestOrgContext(TEST_USER_ID),
          fixture.documentId,
        ),
      ).rejects.toThrow(/submitted certification history/i);

      expect(provider.deleteCalls).toEqual([]);
      expect(provider.objects.has(fixture.storageKey)).toBe(true);
      expect(
        await db
          .select()
          .from(certifierDocumentUploads)
          .where(eq(certifierDocumentUploads.documentId, fixture.documentId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(documents)
          .where(eq(documents.id, fixture.documentId)),
      ).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("refuses deletion when the Source binding plan references the Source", async () => {
    const fixture = await createFixture(crypto.randomUUID().slice(0, 8));
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: fixture.removalId,
      version: 1,
      status: "submitted",
      payloadSnapshot: {
        sourceBindingPlan: [
          {
            sourceId: fixture.externalDocumentId,
            target: "transport",
          },
        ],
      },
    });

    try {
      await expect(
        deleteDocumentWithCertificationSafety(
          makeTestOrgContext(TEST_USER_ID),
          fixture.documentId,
        ),
      ).rejects.toThrow(/submitted certification history/i);

      expect(provider.deleteCalls).toEqual([]);
      expect(provider.objects.has(fixture.storageKey)).toBe(true);
      expect(
        await db
          .select()
          .from(certifierDocumentUploads)
          .where(eq(certifierDocumentUploads.documentId, fixture.documentId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(documents)
          .where(eq(documents.id, fixture.documentId)),
      ).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
