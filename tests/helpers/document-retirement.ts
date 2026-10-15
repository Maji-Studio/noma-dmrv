/**
 * Shared fixtures and assertions for document-retirement specs.
 */
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import {
  certificationSubmissions,
  documents,
  facilities,
  reactors,
  storageObjectDeletions,
  transportLegs,
} from "@/db/schema";
import { __setStorageProviderForTests } from "@/lib/storage";
import type {
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from "@/lib/storage";
import { TEST_ORG_ID } from "./test-org";

const SUBMISSION_VERSION = 1;
const SWEEP_ATTEMPT_COUNT = 1;

export class RetirementStorageProvider implements StorageProvider {
  readonly name = "local-fs" as const;
  readonly bucket = "local-fs";
  readonly objects = new Set<string>();
  readonly deleteCalls: string[] = [];
  failKey: string | null = null;

  async createUploadUrl(): Promise<PresignedUpload> {
    throw new Error("Not used by retirement tests");
  }

  async createDownloadUrl(): Promise<string> {
    throw new Error("Not used by retirement tests");
  }

  async getObject(): Promise<never> {
    throw new Error("Not used by retirement tests");
  }

  async readObjectBounded(): Promise<never> { throw new Error("Not used by this test"); }

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

export async function createReactorFixture(
  tag: string,
  organizationId = TEST_ORG_ID,
) {
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({ timezone: "UTC",
        organizationId,
        code: `FAC-DOC-${tag}`,
        name: `Document retirement facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId,
        facilityId: facility.id,
        code: `RE-DOC-${tag}`,
        identifier: `Document retirement reactor ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning({ id: reactors.id });
    return { facilityId: facility.id, reactorId: reactor.id };
  });
}

export async function insertManagedDocument(
  provider: RetirementStorageProvider,
  entityType: string,
  entityId: string,
  storageKey: string,
  organizationId = TEST_ORG_ID,
) {
  provider.objects.add(storageKey);
  const [document] = await db
    .insert(documents)
    .values({
      organizationId,
      entityType,
      entityId,
      documentType: "pdf",
      storageProvider: "local-fs",
      storageBucket: "local-fs",
      storageKey,
      fileName: "evidence.pdf",
    })
    .returning({ id: documents.id });
  return document.id;
}

export async function expectDerivedLegEvidenceSwept(
  legId: string,
  tag: string,
  mutate: () => Promise<void>,
): Promise<void> {
  const provider = new RetirementStorageProvider();
  const key = `transport_leg/${legId}/pdf/${tag}.pdf`;
  const documentId = await insertManagedDocument(provider, "transport_leg", legId, key);
  __setStorageProviderForTests(provider);

  try {
    await mutate();

    expect(await db.select().from(transportLegs).where(eq(transportLegs.id, legId))).toHaveLength(0);
    expect(await db.select().from(documents).where(eq(documents.id, documentId))).toHaveLength(0);
    expect(provider.deleteCalls).toContain(key);
    expect(provider.objects.has(key)).toBe(false);
    const [deletion] = await db.select().from(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, TEST_ORG_ID),
      eq(storageObjectDeletions.storageKey, key),
    ));
    expect(deletion).toMatchObject({ attemptCount: SWEEP_ATTEMPT_COUNT, completedAt: expect.any(Date) });
  } finally {
    __setStorageProviderForTests(null);
    await db.delete(documents).where(eq(documents.id, documentId));
    await db.delete(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, TEST_ORG_ID),
      eq(storageObjectDeletions.storageKey, key),
    ));
  }
}

export async function insertRemovalSnapshot(args: {
  sourceId: string;
  deleted: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: crypto.randomUUID(),
      version: SUBMISSION_VERSION,
      status: "rejected",
      externalId: null,
      payloadSnapshot: { sourceBindingPlan: [{ sourceId: args.sourceId }] },
      metadata: args.deleted
        ? { deletion: { deletedAt: new Date().toISOString() } }
        : null,
    })
    .returning({ id: certificationSubmissions.id });
  return row.id;
}
