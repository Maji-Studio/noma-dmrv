import { afterEach, expect, it, vi } from "vitest";
import { requestDocumentUploadInput, requestDocumentUploadBodyInput, confirmDocumentUploadInput } from "./document-input";
import { API_DOCUMENT_OWNERS } from "@/lib/documents/api-owners";
import { API_DOCUMENT_TYPES, APP_ONLY_DOCUMENT_TYPES } from "@/lib/documents/api-types";
import { DOCUMENT_TYPES } from "./documents";

const ID = "ABCDEFAB-1234-4234-8234-ABCDEFABCDEF";
const body = { documentType: "bill_of_lading", fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64) };
const input = { ...body, ownerType: "feedstock", ownerId: ID };
afterEach(() => vi.useRealTimers());

it("accepts the declaration and canonicalizes owner UUIDs", () => {
  expect(requestDocumentUploadInput.parse(input)).toMatchObject({ ownerId: ID.toLowerCase() });
});

it.each(Object.entries(API_DOCUMENT_OWNERS))("accepts all published document classifications for %s", (ownerType, owner) => {
  for (const documentType of owner.documentTypes) {
    expect(requestDocumentUploadInput.safeParse({ ...input, ownerType, documentType, contentType: documentType === "photo" ? "image/png" : "application/pdf" }).success).toBe(true);
  }
});

it.each([
  ["documentType", "lab_report"], ["contentType", ""], ["contentType", "text/plain"],
  ["contentType", "image/svg+xml"], ["sha256", undefined], ["sha256", "A".repeat(64)],
  ["fileName", ""], ["fileName", "a".repeat(256)], ["sizeBytes", 0], ["sizeBytes", 1.5],
  ["sizeBytes", 10 * 1024 * 1024 + 1], ["description", "a".repeat(2001)],
  ["capturedAt", "2026-01-01T10:00:00"], ["gpsLatitude", 91], ["gpsLongitude", -181],
])("refuses %s outside the API contract", (field, value) => {
  const parsed = requestDocumentUploadInput.safeParse({ ...input, [field]: value });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: [field] }));
});

it.each(["visibility", "storageProvider", "storageBucket", "storageKey", "metadata", "applicationEvidenceRole", "evidenceRole"])("refuses the private field %s", (field) => {
  expect(requestDocumentUploadInput.safeParse({ ...input, [field]: "private" }).success).toBe(false);
});

it.each([["gpsLatitude", "gpsLongitude"], ["gpsLongitude", "gpsLatitude"]])("requires the partner of %s at its own pointer", (present, missing) => {
  const parsed = requestDocumentUploadInput.safeParse({ ...input, [present]: 0 });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0].path).toEqual([missing]);
  expect(requestDocumentUploadInput.safeParse({ ...input, gpsLatitude: 0, gpsLongitude: 0 }).success).toBe(true);
});

it("allows exactly now, accepts offsets and refuses future capture times", () => {
  vi.useFakeTimers(); vi.setSystemTime("2026-10-15T10:00:00Z");
  expect(requestDocumentUploadInput.safeParse({ ...input, capturedAt: "2026-10-15T12:00:00+02:00" }).success).toBe(true);
  const parsed = requestDocumentUploadInput.safeParse({ ...input, capturedAt: "2026-10-15T10:00:00.001Z" });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0]).toMatchObject({ path: ["capturedAt"], message: "Capture time cannot be in the future. Enter a time at or before now." });
});

it("confirm accepts only the public owner and document identifiers", () => {
  const confirm = { ownerType: "lab_sample", ownerId: ID, documentId: ID };
  expect(confirmDocumentUploadInput.parse(confirm)).toMatchObject({ ownerId: ID.toLowerCase(), documentId: ID.toLowerCase() });
  expect(confirmDocumentUploadInput.safeParse({ ...confirm, inspectedSha256: "a".repeat(64) }).success).toBe(false);
});

it("excludes app-only histograms from the API body schema and type list", () => {
  expect(requestDocumentUploadBodyInput.safeParse({ ...body, documentType: "lab_report" }).success).toBe(true);
  expect(requestDocumentUploadBodyInput.safeParse({ ...body, documentType: "reflectance_histogram" }).success).toBe(false);
  expect(requestDocumentUploadInput.safeParse({ ...input, ownerType: "lab_sample", documentType: "reflectance_histogram" }).success).toBe(false);
  expect(APP_ONLY_DOCUMENT_TYPES).toEqual(["reflectance_histogram"]);
  expect(API_DOCUMENT_TYPES).toEqual(DOCUMENT_TYPES.filter((type) => type !== "reflectance_histogram"));
});
