import { expect, it } from "vitest";
import type { DocumentRow } from "@/data-access/documents";
import { representDocument } from "./documents";
import { documentEtag } from "@/lib/api/representation-etags";

const row: DocumentRow = {
  id: "11111111-1111-4111-8111-111111111111", organizationId: "org", entityType: "sample", entityId: "22222222-2222-4222-8222-222222222222",
  documentType: "lab_report", fileName: "report.pdf", fileSizeBytes: 99, mimeType: "image/png", checksumSha256: "b".repeat(64),
  storageProvider: "local-fs", storageBucket: "private", storageKey: "secret", uploadStorageKey: "secret-upload", uploadExpiresAt: new Date(), fileUrl: null,
  visibility: "private", uploadStatus: "pending", issuedAt: null, capturedAt: null, description: null, createdBy: "user", notes: null,
  metadata: { uploadDeclaration: { contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64), gpsLatitude: 0, gpsLongitude: 12 } },
  version: 1, createdAt: new Date("2026-10-15T10:00:00Z"), updatedAt: new Date("2026-10-15T10:00:00Z"),
};

it("publishes pending declarations and only the specified public fields", () => {
  expect(representDocument(row)).toEqual({ id: row.id, ownerType: "lab_sample", ownerId: row.entityId, documentType: "lab_report", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64), uploadStatus: "pending", capturedAt: null, gpsLatitude: 0, gpsLongitude: 12, description: null, version: 1, createdAt: "2026-10-15T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z" });
  expect(documentEtag(representDocument(row))).toBe('"1.1"');
});

it("publishes verified uploaded fields, nullable legacy checksums and EXIF GPS", () => {
  const uploaded = { ...row, uploadStatus: "uploaded" as const, version: 2, capturedAt: new Date("2026-10-01T12:00:00Z") };
  expect(representDocument(uploaded)).toMatchObject({ contentType: "image/png", sizeBytes: 99, sha256: "b".repeat(64), capturedAt: "2026-10-01T12:00:00.000Z" });
  expect(documentEtag(uploaded)).toBe('"2.1"');
  expect(representDocument({ ...uploaded, checksumSha256: null, metadata: { exif: { gps: { latitude: 1, longitude: 2 } } } })).toMatchObject({ sha256: null, gpsLatitude: 1, gpsLongitude: 2 });
});

it("retains the declaration on failed rows", () => {
  expect(representDocument({ ...row, uploadStatus: "failed", checksumSha256: null })).toMatchObject({
    uploadStatus: "failed", contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64),
  });
});
