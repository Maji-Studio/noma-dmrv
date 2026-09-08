/**
 * Shared fixtures for the parent-document retirement specs
 * (`tests/parent-document-retirement.test.ts`,
 * `tests/parent-document-mirror-release.test.ts`).
 */
import { db } from "@/db";
import { certificationSubmissions, documents, facilities, reactors } from "@/db/schema";
import type {
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from "@/lib/storage";
import { TEST_ORG_ID } from "./test-org";

const SUBMISSION_VERSION = 1;

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
      .values({
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
