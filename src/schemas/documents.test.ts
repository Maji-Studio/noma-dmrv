import { describe, expect, it } from "vitest";
import {
  clampDocumentUploadMaxMb,
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_MAX_MB,
} from "@/lib/documents/upload-policy";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
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
