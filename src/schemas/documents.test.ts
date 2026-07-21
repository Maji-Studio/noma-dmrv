import { describe, expect, it } from "vitest";
import {
  clampDocumentUploadMaxMb,
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_MAX_MB,
} from "@/lib/documents/upload-policy";
import { DOCUMENT_TYPES, maxBytesFor } from "@/schemas/documents";

describe("document upload limits", () => {
  it.each(DOCUMENT_TYPES)("caps %s uploads at 10 MB", (documentType) => {
    expect(maxBytesFor(documentType)).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
  });

  it("clamps historical UI limits to the server policy", () => {
    expect(clampDocumentUploadMaxMb(50)).toBe(DOCUMENT_UPLOAD_MAX_MB);
    expect(clampDocumentUploadMaxMb(5)).toBe(5);
  });
});
