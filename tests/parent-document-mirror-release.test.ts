/**
 * Parent-record deletion and Isometric Source mappings: an unreferenced
 * mapping, or one cited only by a deleted Removal, is released with the
 * record; one a live Removal snapshot still cites keeps the record in place.
 *
 * Requires a real Postgres (`.env.test`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierDocumentUploads,
  documents,
  facilities,
  reactors,
} from "@/db/schema";
import { deleteReactor } from "@/data-access/reactors";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { __setStorageProviderForTests } from "@/lib/storage";
import {
  RetirementStorageProvider,
  createReactorFixture,
  insertManagedDocument,
  insertRemovalSnapshot,
} from "./helpers/document-retirement";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "parent-document-mirror-release-user";

let provider: RetirementStorageProvider;

beforeAll(() => ensureTestOrg());

beforeEach(() => {
  provider = new RetirementStorageProvider();
  __setStorageProviderForTests(provider);
});

afterEach(() => {
  __setStorageProviderForTests(null);
});

describe("parent document mirror release", () => {
  it.each([
    { label: "unreferenced", snapshot: null },
    { label: "cited only by a deleted Removal", snapshot: { deleted: true } },
  ])(
    "releases an Isometric mirror that is $label and deletes the record",
    async ({ snapshot }) => {
      const tag = crypto.randomUUID().slice(0, 8);
      const fixture = await createReactorFixture(tag);
      const key = `reactor/${fixture.reactorId}/pdf/${tag}.pdf`;
      const documentId = await insertManagedDocument(provider, "reactor", fixture.reactorId, key);
      const sourceId = `src_${tag}`;
      let submissionId: string | null = null;

      try {
        await db.insert(certifierDocumentUploads).values({
          organizationId: TEST_ORG_ID,
          documentId,
          provider: "isometric",
          externalDocumentId: sourceId,
        });
        if (snapshot) {
          submissionId = await insertRemovalSnapshot({ sourceId, deleted: snapshot.deleted });
        }

        await deleteReactor(makeTestOrgContext(TEST_USER_ID), fixture.reactorId);
        await processPendingStorageObjectDeletions(makeTestOrgContext(TEST_USER_ID));

        expect(provider.objects.has(key)).toBe(false);
        expect(
          await db
            .select()
            .from(certifierDocumentUploads)
            .where(eq(certifierDocumentUploads.documentId, documentId)),
        ).toHaveLength(0);
        expect(
          await db.select().from(documents).where(eq(documents.id, documentId)),
        ).toHaveLength(0);
      } finally {
        if (submissionId) {
          await db
            .delete(certificationSubmissions)
            .where(eq(certificationSubmissions.id, submissionId));
        }
        await db
          .delete(certifierDocumentUploads)
          .where(eq(certifierDocumentUploads.documentId, documentId));
        await db.delete(documents).where(eq(documents.id, documentId));
        await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
        await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
      }
    },
  );

  it("blocks an Isometric mirror that a live Removal snapshot still cites", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const fixture = await createReactorFixture(tag);
    const key = `reactor/${fixture.reactorId}/pdf/${tag}.pdf`;
    const documentId = await insertManagedDocument(provider, "reactor", fixture.reactorId, key);
    const sourceId = `src_${tag}`;
    let submissionId: string | null = null;

    try {
      await db.insert(certifierDocumentUploads).values({
        organizationId: TEST_ORG_ID,
        documentId,
        provider: "isometric",
        externalDocumentId: sourceId,
      });
      submissionId = await insertRemovalSnapshot({ sourceId, deleted: false });

      await expect(
        deleteReactor(makeTestOrgContext(TEST_USER_ID), fixture.reactorId),
      ).rejects.toThrow(/certification provider/);

      expect(provider.deleteCalls).toEqual([]);
      expect(provider.objects.has(key)).toBe(true);
      expect(
        await db
          .select()
          .from(certifierDocumentUploads)
          .where(eq(certifierDocumentUploads.documentId, documentId)),
      ).toHaveLength(1);
    } finally {
      if (submissionId) {
        await db
          .delete(certificationSubmissions)
          .where(eq(certificationSubmissions.id, submissionId));
      }
      await db
        .delete(certifierDocumentUploads)
        .where(eq(certifierDocumentUploads.documentId, documentId));
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(reactors).where(eq(reactors.id, fixture.reactorId));
      await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
    }
  });
});
