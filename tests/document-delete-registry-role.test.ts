/**
 * Registry role floor for document deletion and parent retirement (issue #1188).
 * Requires real Postgres; storage is stubbed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  certificationSubmissions,
  certifierDocumentUploads,
  certifierRemovals,
  creditBatches,
  documents,
  facilities,
  feedstockTypes,
  productionProcesses,
  storageObjectDeletions,
} from "@/db/schema";
import { deleteCreditBatch } from "@/data-access/credit-batches";
import {
  DOCUMENT_REGISTRY_ROLE_ERROR,
  PARENT_DOCUMENT_REGISTRY_ROLE_ERROR,
} from "@/data-access/documents";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { deleteDocumentApp } from "@/lib/operations/documents";
import { runOperationInProcess } from "@/lib/operations/runner";
import { __setStorageProviderForTests } from "@/lib/storage";
import { RetirementStorageProvider } from "./helpers/document-retirement";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
  TEST_SITE_POSITION,
} from "./helpers/test-org";

const TEST_USER_ID = "document-delete-registry-role-user";
const INITIAL_VERSION = 1;
const OWNER = makeTestOrgContext(TEST_USER_ID);
const MEMBER: OrgContext = { ...OWNER, orgRole: "member" };
const ADMIN: OrgContext = { ...OWNER, orgRole: "admin" };
const PLATFORM_ADMIN: OrgContext = { ...OWNER, orgRole: null, isPlatformAdmin: true };

interface Fixture {
  facility: typeof facilities.$inferSelect;
  removal: typeof certifierRemovals.$inferSelect;
  feedstockType: typeof feedstockTypes.$inferSelect;
  process: typeof productionProcesses.$inferSelect;
  batch: typeof creditBatches.$inferSelect;
  document: typeof documents.$inferSelect & { storageKey: string };
}

let provider: RetirementStorageProvider;
const fixtures: Fixture[] = [];

beforeAll(() => ensureTestOrg());
beforeEach(() => {
  provider = new RetirementStorageProvider();
  __setStorageProviderForTests(provider);
});
afterEach(async () => {
  __setStorageProviderForTests(null);
  for (const fixture of fixtures.splice(0)) {
    await db.delete(activityEvents).where(and(
      eq(activityEvents.organizationId, TEST_ORG_ID),
      inArray(activityEvents.entityId, [fixture.batch.id, fixture.document.id]),
    ));
    await db.delete(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, TEST_ORG_ID),
      eq(storageObjectDeletions.storageKey, fixture.document.storageKey),
    ));
    await db.delete(certifierDocumentUploads).where(and(
      eq(certifierDocumentUploads.organizationId, TEST_ORG_ID),
      eq(certifierDocumentUploads.documentId, fixture.document.id),
    ));
    await db.delete(documents).where(and(
      eq(documents.organizationId, TEST_ORG_ID), eq(documents.id, fixture.document.id),
    ));
    await db.delete(creditBatches).where(and(
      eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, fixture.batch.id),
    ));
    await db.delete(certificationSubmissions).where(and(
      eq(certificationSubmissions.organizationId, TEST_ORG_ID),
      eq(certificationSubmissions.localEntityId, fixture.removal.id),
    ));
    await db.delete(certifierRemovals).where(and(
      eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removal.id),
    ));
    await db.delete(productionProcesses).where(and(
      eq(productionProcesses.organizationId, TEST_ORG_ID), eq(productionProcesses.id, fixture.process.id),
    ));
    await db.delete(feedstockTypes).where(and(
      eq(feedstockTypes.organizationId, TEST_ORG_ID), eq(feedstockTypes.id, fixture.feedstockType.id),
    ));
    await db.delete(facilities).where(and(
      eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.id, fixture.facility.id),
    ));
  }
});

async function createFixture(mapped = true): Promise<Fixture> {
  const tag = crypto.randomUUID();
  const fixture = await db.transaction(async (tx) => {
    const [facility] = await tx.insert(facilities).values({
      ...TEST_SITE_POSITION, timezone: "UTC", organizationId: TEST_ORG_ID,
      code: `FAC-DOC-ROLE-${tag}`, name: `Document registry role ${tag}`,
    }).returning();
    const [removal] = await insertRemovalFixture(tx, {
      organizationId: TEST_ORG_ID, facilityId: facility.id, provider: "isometric",
      metadata: { submissionExternalMutationPossible: true },
    });
    const [feedstockType] = await tx.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID, code: `FT-DOC-ROLE-${tag}`,
      name: `Document registry role ${tag}`, category: "forestry", usage: "pyrolysis",
    }).returning();
    const [process] = await tx.insert(productionProcesses).values({
      organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id,
    }).returning();
    const [batch] = await tx.insert(creditBatches).values({
      organizationId: TEST_ORG_ID, facilityId: facility.id,
      feedstockTypeId: feedstockType.id, productionProcessId: process.id,
      code: `CB-DOC-ROLE-${tag}`, startDate: "2026-01-01", endDate: "2026-01-31",
    }).returning();
    const storageKey = `credit_batch/${batch.id}/${tag}.pdf`;
    const [document] = await tx.insert(documents).values({
      organizationId: TEST_ORG_ID, entityType: "credit_batch", entityId: batch.id,
      documentType: "pdf", storageProvider: "local-fs", storageBucket: "local-fs",
      storageKey, fileName: "evidence.pdf",
    }).returning();
    if (mapped) {
      await tx.insert(certifierDocumentUploads).values({
        organizationId: TEST_ORG_ID, documentId: document.id,
        provider: "isometric", externalDocumentId: `src_doc_role_${tag}`,
      });
    }
    return { facility, removal, feedstockType, process, batch, document: { ...document, storageKey } };
  });
  fixtures.push(fixture);
  provider.objects.add(fixture.document.storageKey);
  return fixture;
}

function deleteViaApp(ctx: OrgContext, fixture: Fixture) {
  return runOperationInProcess(deleteDocumentApp, ctx, {
    documentId: fixture.document.id, expectedVersion: fixture.document.version,
  });
}

async function expectEvidencePresent(
  fixture: Fixture,
  present: boolean,
) {
  const documentRows = await db.select().from(documents).where(and(
    eq(documents.organizationId, TEST_ORG_ID), eq(documents.id, fixture.document.id),
  ));
  const mappings = await db.select().from(certifierDocumentUploads).where(and(
    eq(certifierDocumentUploads.organizationId, TEST_ORG_ID),
    eq(certifierDocumentUploads.documentId, fixture.document.id),
  ));
  expect(documentRows.map(row => row.id)).toEqual(present ? [fixture.document.id] : []);
  expect(mappings.map(row => row.documentId)).toEqual(present ? [fixture.document.id] : []);
}

describe("document registry deletion role floor", () => {
  it("preserves pre-ledger mirrored evidence when a Member tries to delete it", async () => {
    const fixture = await createFixture();
    expect(fixture.removal.metadata).toMatchObject({ submissionExternalMutationPossible: true });
    expect(await db.select().from(certificationSubmissions).where(and(
      eq(certificationSubmissions.organizationId, TEST_ORG_ID),
      eq(certificationSubmissions.localEntityId, fixture.removal.id),
    ))).toEqual([]);

    await expect(deleteViaApp(MEMBER, fixture)).rejects.toMatchObject({
      code: "forbidden", message: DOCUMENT_REGISTRY_ROLE_ERROR,
    });
    await expectEvidencePresent(fixture, true);
    expect(provider.deleteCalls).toEqual([]);
  });

  it.each([
    ["Admin", ADMIN],
    ["Platform Admin without org membership", PLATFORM_ADMIN],
  ])("lets the %s delete pre-ledger mirrored evidence", async (_label, ctx) => {
    const fixture = await createFixture();
    expect(await deleteViaApp(ctx, fixture)).toMatchObject({ id: fixture.document.id });
    await expectEvidencePresent(fixture, false);
    expect(provider.objects.has(fixture.document.storageKey)).toBe(false);
  });

  it("lets a Member delete evidence that has no registry mapping", async () => {
    const fixture = await createFixture(false);
    expect(await deleteViaApp(MEMBER, fixture)).toMatchObject({ id: fixture.document.id });
    await expectEvidencePresent(fixture, false);
  });

  it("rolls back Member credit batch deletion, then lets an Admin retire the same evidence", async () => {
    const fixture = await createFixture();
    await expect(deleteCreditBatch(MEMBER, fixture.batch.id, INITIAL_VERSION))
      .rejects.toThrow(new SafeError(PARENT_DOCUMENT_REGISTRY_ROLE_ERROR));
    expect(await db.select({ id: creditBatches.id }).from(creditBatches).where(and(
      eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, fixture.batch.id),
    ))).toEqual([{ id: fixture.batch.id }]);
    await expectEvidencePresent(fixture, true);
    expect(provider.deleteCalls).toEqual([]);

    await deleteCreditBatch(OWNER, fixture.batch.id, INITIAL_VERSION);
    expect(await db.select().from(creditBatches).where(and(
      eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, fixture.batch.id),
    ))).toEqual([]);
    await expectEvidencePresent(fixture, false);
    expect(provider.objects.has(fixture.document.storageKey)).toBe(false);
  });
});
