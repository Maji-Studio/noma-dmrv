import { describe, expect, it } from "vitest";
import {
  clampDocumentUploadMaxMb,
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_MAX_MB,
} from "@/lib/documents/upload-policy";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_ENTITY_TYPES,
  requestUploadSchema,
  isAllowedMime,
  maxBytesFor,
} from "@/schemas/documents";
import { TRANSPORT_EVIDENCE_DOCUMENT_TYPES } from "@/lib/certification/transport-evidence";

describe("document upload limits", () => {
  it.each(DOCUMENT_TYPES)("caps %s uploads at 10 MB", (documentType) => {
    expect(maxBytesFor(documentType)).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
  });

  it("clamps historical UI limits to the server policy", () => {
    expect(clampDocumentUploadMaxMb(50)).toBe(DOCUMENT_UPLOAD_MAX_MB);
    expect(clampDocumentUploadMaxMb(5)).toBe(5);
  });

  it.each(TRANSPORT_EVIDENCE_DOCUMENT_TYPES)(
    "accepts PDFs and images for %s",
    (documentType) => {
      expect(isAllowedMime(documentType, "application/pdf")).toBe(true);
      expect(isAllowedMime(documentType, "image/jpeg")).toBe(true);
      expect(isAllowedMime(documentType, "text/plain")).toBe(false);
    },
  );

  it.each([
    "application/geo+json",
    "application/json",
    "text/plain",
    "",
  ])("accepts %j for GIS boundary documents", (contentType) => {
    expect(isAllowedMime("gis_boundary", contentType)).toBe(true);
  });

  it("labels GIS boundary documents", () => {
    expect(DOCUMENT_TYPE_LABELS.gis_boundary).toBe("GIS boundary");
  });
});

const histogramUpload = { entityType: "sample", entityId: "11111111-1111-4111-8111-111111111111", documentType: "reflectance_histogram", fileName: "histogram.pdf", contentType: "application/pdf", sizeBytes: 100 };
it("accepts histogram evidence on Samples with PDF, image and tabular formats", () => {
  expect(requestUploadSchema.safeParse(histogramUpload).success).toBe(true);
  expect(DOCUMENT_TYPE_LABELS.reflectance_histogram).toBe("Reflectance histogram");
  for (const mime of ["application/pdf", "image/png", "text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]) {
    expect(isAllowedMime("reflectance_histogram", mime)).toBe(true);
  }
  expect(isAllowedMime("reflectance_histogram", "video/mp4")).toBe(false);
  expect(maxBytesFor("reflectance_histogram")).toBe(maxBytesFor("lab_report"));
});
it.each(DOCUMENT_ENTITY_TYPES.filter((owner) => owner !== "sample"))("refuses histogram uploads on %s", (entityType) => {
  expect(requestUploadSchema.safeParse({ ...histogramUpload, entityType }).success).toBe(false);
});

it("supports the thirteen current document owners", () => {
  expect(DOCUMENT_ENTITY_TYPES).toEqual(["sample", "delivery", "production_run", "production_incident", "production_sample", "biochar_product", "feedstock", "application", "credit_batch", "facility", "reactor", "order", "transport_leg"]);
});
