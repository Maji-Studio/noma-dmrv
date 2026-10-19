import { expect, it } from "vitest";
import { requestUploadSchema } from "@/schemas/documents";
import { buildDocumentMetadata } from "./metadata";

it.each([{ gpsLatitude: 12 }, { gpsLongitude: 34 }])("drops incomplete EXIF GPS: %j", (gps) => {
  const input = requestUploadSchema.parse({ entityType: "facility", entityId: "12345678-1234-4234-8234-123456789abc", documentType: "photo", fileName: "photo.jpg", contentType: "image/jpeg", sizeBytes: 8, capturedAt: "2026-10-01T00:00:00Z", ...gps });
  expect(buildDocumentMetadata(input)).toMatchObject({ geotagStatus: "missing", missingExif: ["gps"], exif: { gps: null } });
});
