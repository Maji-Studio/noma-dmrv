import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, users, storageObjectDeletions } from "@/db/schema";
import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction, uploadFactsFor } from "@/data-access/document-writes";
import { deleteDocumentInTransaction, setDocumentVisibilityInTransaction, updateApplicationEvidenceMetadataInTransaction } from "@/data-access/document-mutations";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { makeTestOrgContext } from "./helpers/test-org";
const ctx = makeTestOrgContext();
it.each(["feedstock", "delivery", "sample", "application", "production_run"] as const)("guards every document mutation on a submitted %s", async (entityType) => {
  const fixture = await createLineageFixture("removal");
  const entityId = ({ feedstock: fixture.feedstockId, delivery: fixture.deliveryId, sample: fixture.sampleId, application: fixture.applicationId, production_run: fixture.productionRunId })[entityType];
  await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  const input = { entityType, entityId, documentType: "pdf" as const, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: "local-fs", storageBucket: "local-fs" };
  const [row] = await db.insert(documents).values({ organizationId: ctx.organizationId, entityType, entityId, documentType: "pdf", fileName: "report.pdf", storageProvider: "local-fs", storageBucket: "local-fs", storageKey: `org/${ctx.organizationId}/uploads/${entityId}/test`, uploadStorageKey: `org/${ctx.organizationId}/uploads/${entityId}/test`, uploadExpiresAt: new Date(), uploadStatus: "pending", metadata: { uploadDeclaration: { sizeBytes: 8, contentType: "application/pdf", sha256: null } } }).returning();
  try {
    await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input))).rejects.toMatchObject({ code: "certification_locked" });
    await expect(db.transaction((tx) => deleteDocumentInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version }))).rejects.toMatchObject({ code: "certification_locked" });
    await expect(db.transaction((tx) => setDocumentVisibilityInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version, visibility: "public" }))).rejects.toMatchObject({ code: "certification_locked" });
    await expect(db.transaction((tx) => updateApplicationEvidenceMetadataInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version, applicationLogbookEvidenceType: "inventory" }))).rejects.toMatchObject({ code: "certification_locked" });
    expect(await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, { ...uploadFactsFor(row), refusal: "certification_locked" }))).toMatchObject({ kind: "refused", reason: "certification_locked", document: { uploadStatus: "failed", version: 2 } });
  } finally {
    await db.delete(storageObjectDeletions).where(and(eq(storageObjectDeletions.organizationId, ctx.organizationId), eq(storageObjectDeletions.storageKey, row.storageKey!)));
    await db.delete(documents).where(and(eq(documents.entityId, entityId), eq(documents.organizationId, ctx.organizationId)));
    await cleanupLineageFixture(fixture);
  }
});
it("keeps generated ledger and GHG report writers available on submitted lineage", async () => {
  const { randomUUID } = await import("node:crypto");
  const { insertDocument } = await import("@/data-access/documents");
  const { insertPreparedGhgStatementReport } = await import("@/data-access/ghg-statement-reports");
  const { certifierGhgStatementReports } = await import("@/db/schema");
  const { buildGhgStatementReportModel } = await import("@/lib/certification/ghg-statement-report/model");
  const fixture = await createLineageFixture("ghgStatement");
  const ids: string[] = []; const reportId = randomUUID();
  await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  try {
    const ledger = await insertDocument(ctx, { entityType: "credit_batch", entityId: fixture.batchId, documentType: "pdf", fileName: "ledger.pdf", storageProvider: "local-fs", storageBucket: "local-fs", storageKey: `org/${ctx.organizationId}/transport-evidence/${randomUUID()}.pdf`, checksumSha256: "a".repeat(64), uploadStatus: "uploaded" }); ids.push(ledger.id);
    expect(ledger.uploadStatus).toBe("uploaded");
    const preparedAt = new Date();
    const reportModel = buildGhgStatementReportModel({ reportVersion: 1, preparedAt: preparedAt.toISOString(), documentControl: { organizationName: "Test", facilityCode: "TEST", externalProjectId: "test", externalGhgStatementId: "test", reportingPeriodStartOn: "2026-06-01", reportingPeriodEndOn: "2026-06-30", standardVersion: "1.7", protocolVersion: "1.1.1", configuredProtocolVersion: null }, authoritativeStatement: { externalEntryIds: ["entry"], pendingTotalCo2eRemovedKg: 0, creditAllocation: null }, remoteEntries: [{ id: "entry", startedOn: "2026-06-01", completedOn: "2026-06-30", netRemovedKg: 0, netRemovedWithoutDiscountKg: 0, netRemovedStandardDeviationKg: null }] });
    const documentId = randomUUID(); ids.push(documentId);
    const report = await insertPreparedGhgStatementReport(ctx, { reportId, ghgStatementId: fixture.ghgStatementId!, documentId, version: 1, sourceFingerprint: reportModel.sourceFingerprint, contentChecksumSha256: "b".repeat(64), frozenInput: {}, reportModel, preparationKey: randomUUID(), verifierTokenHash: "c".repeat(64), preparedAt, storage: { provider: "local-fs", bucket: "local-fs", key: `org/${ctx.organizationId}/ghgStatementReport/${reportId}/report.pdf`, fileName: "report.pdf", fileSizeBytes: 8 } });
    expect(report.document).toMatchObject({ uploadStatus: "uploaded", entityType: "ghgStatementReport" });
  } finally {
    await db.delete(certifierGhgStatementReports).where(eq(certifierGhgStatementReports.id, reportId));
    for (const id of ids) await db.delete(documents).where(eq(documents.id, id));
    await cleanupLineageFixture(fixture);
  }
});

it.each(["transport_leg", "production_incident", "production_sample", "order", "biochar_product", "credit_batch"] as const)("maps %s evidence to its lineage, allowing drafts and refusing submitted evidence", async (entityType) => {
  const schema = await import("@/db/schema");
  const { cleanupDocumentUploads } = await import("./helpers/document-upload-cleanup");
  const fixture = await createLineageFixture("none");
  const ids: string[] = [];
  let childId: string | undefined;
  const tag = crypto.randomUUID();
  await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  try {
    let entityId: string;
    if (entityType === "transport_leg") {
      const [row] = await db.insert(schema.transportLegs).values({ organizationId: ctx.organizationId, entityType: "feedstock", entityId: fixture.feedstockId, transportMethodType: "road", distanceKm: 1, loadMassKg: 1 }).returning(); entityId = childId = row.id;
    } else if (entityType === "production_incident") {
      const [row] = await db.insert(schema.incidentReports).values({ organizationId: ctx.organizationId, productionRunId: fixture.productionRunId, incidentTime: new Date(), description: "Test incident", severity: "low" }).returning(); entityId = childId = row.id;
    } else if (entityType === "production_sample") {
      const [row] = await db.insert(schema.productionSamples).values({ organizationId: ctx.organizationId, productionRunId: fixture.productionRunId, timestamp: new Date() }).returning(); entityId = childId = row.id;
    } else entityId = { order: fixture.orderId, biochar_product: fixture.productId, credit_batch: fixture.batchId }[entityType];
    const input = { entityType, entityId, documentType: "pdf" as const, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: "local-fs", storageBucket: "local-fs" };
    const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input)); ids.push(row.id);
    expect(row.uploadStatus).toBe("pending");
    await db.insert(schema.certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status: "submitted", payloadHash: tag, payloadSnapshot: {}, submittedAt: new Date() });
    await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input))).rejects.toMatchObject({ code: "certification_locked" });
  } finally {
    await cleanupDocumentUploads(ctx, ids);
    if (childId && entityType === "production_incident") await db.delete(schema.incidentReports).where(eq(schema.incidentReports.id, childId));
    if (childId && entityType === "production_sample") await db.delete(schema.productionSamples).where(eq(schema.productionSamples.id, childId));
    await cleanupLineageFixture(fixture);
  }
});
