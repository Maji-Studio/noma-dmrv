import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, productionRuns, productionRunReadings, transportLegs, users } from "@/db/schema";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { __setStorageProviderForTests } from "@/lib/storage";
import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction } from "@/data-access/document-writes";
import { updateApplicationEvidenceMetadataInTransaction, deleteDocumentInTransaction, setDocumentVisibilityInTransaction } from "@/data-access/document-mutations";
import { prepareDocumentUpload } from "@/lib/documents/upload-preparation";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { makeTestOrgContext } from "./helpers/test-org";
import type { RequestUploadInput } from "@/schemas/documents";
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn() }));
import { requireOrgContext } from "@/lib/auth/server";
import { importProductionRunReadingsFromDocumentFn } from "@/fn/production-run-reading-imports";
const ctx = makeTestOrgContext();
it("preserves internal app owners, GIS MIME allowances, photo roles, sample flow and readings import", async () => {
  const fixture = await createLineageFixture("none"); const ids: string[] = [];
  const root = await mkdtemp(join(tmpdir(), "document-compatibility-"));
  const provider = new LocalFsProvider({ root, appUrl: "http://localhost", signingSecret: "test" });
  __setStorageProviderForTests(provider); vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  try {
  const [leg] = await db.insert(transportLegs).values({ organizationId: ctx.organizationId, entityType: "feedstock", entityId: fixture.feedstockId, transportMethodType: "road", distanceKm: 1, loadMassKg: 1 }).returning();
  async function upload(input: Omit<RequestUploadInput, "sizeBytes">, bytes: Buffer) {
    const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, { ...input, sizeBytes: bytes.length, storageProvider: provider.name, storageBucket: provider.bucket })); ids.push(row.id);
    await provider.putObject(row.storageKey!, bytes, input.contentType);
    const prepared = await prepareDocumentUpload(ctx, row.id, provider); if (prepared.kind !== "prepared") throw new Error("Expected pending");
    const outcome = await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, prepared.facts)); if (outcome.kind !== "uploaded") throw new Error("Expected uploaded"); return outcome.document;
  }
    for (const [entityType, entityId] of [["feedstock", fixture.feedstockId], ["delivery", fixture.deliveryId], ["transport_leg", leg.id], ["sample", fixture.sampleId]] as const) {
      const row = await upload({ entityType, entityId, documentType: "lab_report", fileName: "report.pdf", contentType: "application/pdf" }, Buffer.from("%PDF-1.7"));
      expect((await db.transaction((tx) => setDocumentVisibilityInTransaction(ctx, tx, { documentId: row.id, visibility: "public" }))).version).toBe(3);
      expect((await db.transaction((tx) => deleteDocumentInTransaction(ctx, tx, { documentId: row.id }))).id).toBe(row.id);
    }
    for (const contentType of ["", "text/plain"]) {
      expect((await upload({ entityType: "application", entityId: fixture.applicationId, documentType: "gis_boundary", fileName: "boundary.geojson", contentType }, Buffer.from("{}"))).mimeType).toBe(contentType);
    }
    const photo = await upload({ entityType: "application", entityId: fixture.applicationId, documentType: "photo", fileName: "photo.png", contentType: "image/png", applicationEvidenceRole: "stockpile" }, Buffer.from("89504e470d0a1a0a", "hex"));
    expect(photo.metadata).toMatchObject({ evidenceRole: "stockpile", geotagStatus: "missing" });
    expect(await db.transaction((tx) => updateApplicationEvidenceMetadataInTransaction(ctx, tx, { documentId: photo.id, applicationEvidenceRole: "spreading" }))).toMatchObject({ version: 3, metadata: { evidenceRole: "spreading", geotagStatus: "missing" } });
    await expect(db.transaction((tx) => updateApplicationEvidenceMetadataInTransaction(ctx, tx, { documentId: photo.id, applicationLogbookEvidenceType: "inventory" }))).rejects.toThrow("only be set on logbook documents");
    const legacyPdf = await upload({ entityType: "application", entityId: fixture.applicationId, documentType: "pdf", fileName: "logbook.pdf", contentType: "application/pdf" }, Buffer.from("%PDF-1.7"));
    await expect(db.transaction((tx) => updateApplicationEvidenceMetadataInTransaction(ctx, tx, { documentId: legacyPdf.id, applicationEvidenceRole: "stockpile" }))).rejects.toThrow("only be set on photos");
    expect(await db.transaction((tx) => updateApplicationEvidenceMetadataInTransaction(ctx, tx, { documentId: legacyPdf.id, applicationLogbookEvidenceType: "inventory" }))).toMatchObject({ metadata: { logbookEvidenceType: "inventory" }, version: 3 });
    await db.update(productionRuns).set({ endTime: new Date("2026-06-13T12:00:00Z"), status: "complete" }).where(eq(productionRuns.id, fixture.productionRunId));
    const requestReadings = { entityType: "production_run" as const, entityId: fixture.productionRunId, documentType: "sensor_data" as const, fileName: "readings.xlsx", contentType: "text/csv", sizeBytes: 3, storageProvider: provider.name, storageBucket: provider.bucket };
    await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, requestReadings))).rejects.toMatchObject({ code: "validation_failed" });
    const csv = Buffer.from("timestamp_utc,temperature_c,pressure_bar\n2026-06-13T09:00:00Z,500,1.2\n");
    const readings = await upload({ entityType: "production_run", entityId: fixture.productionRunId, documentType: "sensor_data", fileName: "readings.csv", contentType: "text/csv" }, csv);
    const malformed = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, { ...requestReadings, fileName: "readings.csv" })); ids.push(malformed.id);
    await db.update(documents).set({ fileName: "readings.xlsx" }).where(eq(documents.id, malformed.id));
    await provider.putObject(malformed.uploadStorageKey!, Buffer.from("a,b"), "text/csv");
    const inspected = await prepareDocumentUpload(ctx, malformed.id, provider);
    if (inspected.kind !== "prepared") throw new Error("Expected pending CSV");
    expect(await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, inspected.facts))).toMatchObject({ kind: "refused", reason: "format", pointer: "/fileName", document: { uploadStatus: "failed" } });
    const read = vi.spyOn(provider, "getObject");
    expect(await importProductionRunReadingsFromDocumentFn({ documentId: readings.id })).toMatchObject({ success: true, data: { insertedRows: 1 } });
    expect(read).toHaveBeenCalledWith({ key: readings.storageKey }); expect(readings.storageKey).not.toBe(readings.uploadStorageKey);
  } finally {
    __setStorageProviderForTests(null); await cleanupDocumentUploads(ctx, ids); await db.delete(productionRunReadings).where(eq(productionRunReadings.productionRunId, fixture.productionRunId)); await cleanupLineageFixture(fixture); await rm(root, { recursive: true, force: true });
  }
});
