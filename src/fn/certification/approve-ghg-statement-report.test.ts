import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storageModule from "@/lib/storage";
import { logger } from "@/lib/log";
import type { GhgStatementReportRow } from "@/data-access/ghg-statement-reports";
import type { DocumentRow } from "@/data-access/documents";
import { __setStorageProviderForTests, StorageError, type StorageProvider } from "@/lib/storage";
import { REPORT_ID, REPORT_DOCUMENT_ID, STATEMENT_ID } from "../../../tests/fixtures/isometric-ghg-statement";

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(async () => ({ organizationId: "org-test", userId: "user-test", orgRole: "owner" })),
  requireOrgRole: vi.fn(),
}));
vi.mock("@/data-access/documents", () => ({ getDocumentById: vi.fn() }));
vi.mock("@/data-access/ghg-statement-reports", () => ({
  getGhgStatementReportById: vi.fn(), approveGhgStatementReport: vi.fn(),
}));
vi.mock("./ghg-statement-report-core", () => ({
  rebuildGhgStatementReportModel: vi.fn(async () => ({ sourceFingerprint: "fresh" })),
}));
import { getDocumentById } from "@/data-access/documents";
import { getGhgStatementReportById, approveGhgStatementReport as approveRow } from "@/data-access/ghg-statement-reports";
import { approveGhgStatementReport } from "./ghg-statement-reports";

// Known SHA-256 test vector. Verification does not parse or render the PDF.
const ORIGINAL_BYTES = Buffer.from("abc");
const CHECKSUM = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const STORAGE_KEY = `org/org-test/ghgStatementReport/${REPORT_ID}/pdf/report.pdf`;
let report: GhgStatementReportRow;
let document: DocumentRow;
const readObjectBounded = vi.fn<StorageProvider["readObjectBounded"]>();
const approve = () => approveGhgStatementReport({ ghgStatementId: STATEMENT_ID, reportId: REPORT_ID, version: 1 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  report = {
    id: REPORT_ID, organizationId: "org-test", documentId: REPORT_DOCUMENT_ID,
    ghgStatementId: STATEMENT_ID, version: 1, lifecycle: "prepared",
    sourceFingerprint: "fresh", contentChecksumSha256: CHECKSUM,
  } as GhgStatementReportRow;
  document = {
    id: REPORT_DOCUMENT_ID, organizationId: "org-test", entityType: "ghgStatementReport",
    entityId: REPORT_ID, uploadStatus: "uploaded", storageProvider: "local-fs",
    storageBucket: "test", storageKey: STORAGE_KEY, mimeType: "application/pdf",
    fileSizeBytes: ORIGINAL_BYTES.length, checksumSha256: CHECKSUM,
  } as DocumentRow;
  vi.mocked(getGhgStatementReportById).mockImplementation(async () => report);
  vi.mocked(getDocumentById).mockImplementation(async () => document);
  vi.mocked(approveRow).mockImplementation(async () => {
    report.lifecycle = "approved";
    return report;
  });
  readObjectBounded.mockResolvedValue({ bytes: ORIGINAL_BYTES, sizeBytes: 3, sha256: CHECKSUM, contentType: "application/pdf" });
  __setStorageProviderForTests({
    name: "local-fs", bucket: "test", readObjectBounded,
    createUploadUrl: vi.fn(), createDownloadUrl: vi.fn(), getObject: vi.fn(),
    headObject: vi.fn(), deleteObject: vi.fn(), putObject: vi.fn(),
  });
});
afterEach(() => { vi.restoreAllMocks(); __setStorageProviderForTests(null); });

describe("stored GHG Statement report approval", () => {
  it("keeps a truncated report prepared", async () => {
    readObjectBounded.mockResolvedValue({ bytes: Buffer.from("ab"), sizeBytes: 2, sha256: "changed", contentType: "application/pdf" });
    expect(await approve()).toEqual({
      success: false, code: "report_verification_failed",
      error: "Version 1 of the GHG Statement report failed the file size check. Prepare a new report.",
    });
    expect(report.lifecycle).toBe("prepared");
    expect(approveRow).not.toHaveBeenCalled();
  });
});

// Stored-PDF verification before approval/submission — verify provider, bucket, key, MIME, size, and SHA-256 against the stored record.
describe("stored report checks", () => {
  it.each([
    ["storageProvider", "s3", "storage location"],
    ["storageBucket", "other", "storage location"],
    ["storageKey", null, "stored file"],
    ["storageKey", `org/other/ghgStatementReport/${REPORT_ID}/pdf/report.pdf`, "stored file"],
    ["storageKey", `org/org-test/ghgStatementReport/another-report/pdf/report.pdf`, "stored file"],
    ["storageKey", `org/org-test/ghgStatementReport/${REPORT_ID}/pdf/../report.pdf`, "stored file"],
    ["mimeType", "text/plain", "file type"],
    ["fileSizeBytes", null, "file size"],
    ["checksumSha256", null, "file fingerprint (SHA-256)"],
    ["checksumSha256", "0".repeat(64), "file fingerprint (SHA-256)"],
    ["uploadStatus", "pending", "stored file"],
    ["entityId", "another-report", "stored file"],
  ] as const)("refuses %s = %s", async (field, value, check) => {
    Object.assign(document, { [field]: value });
    expect(await approve()).toEqual({
      success: false, code: "report_verification_failed",
      error: `Version 1 of the GHG Statement report failed the ${check} check. Prepare a new report.`,
    });
    expect(report.lifecycle).toBe("prepared");
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ reportId: REPORT_ID, documentId: REPORT_DOCUMENT_ID, check: expect.any(String), storageErrorCode: null }, expect.any(String));
  });

  it("rejects a same-size replacement", async () => {
    readObjectBounded.mockResolvedValue({ bytes: Buffer.from("xyz"), sizeBytes: 3, sha256: "changed", contentType: "application/pdf" });
    expect(await approve()).toMatchObject({ success: false, code: "report_verification_failed", error: expect.stringContaining("file fingerprint (SHA-256)") });
    expect(report.lifecycle).toBe("prepared");
  });

  it("compares the freshly computed hash to the report row too", async () => {
    report.contentChecksumSha256 = "0".repeat(64);
    expect(await approve()).toMatchObject({ success: false, code: "report_verification_failed", error: expect.stringContaining("file fingerprint (SHA-256)") });
  });

  it("checks the object MIME type", async () => {
    readObjectBounded.mockResolvedValue({ bytes: ORIGINAL_BYTES, sizeBytes: 3, sha256: CHECKSUM, contentType: "text/plain" });
    expect(await approve()).toMatchObject({ success: false, code: "report_verification_failed", error: expect.stringContaining("file type") });
  });

  it.each([
    new StorageError("read failed", "get_object_timeout"),
    Object.assign(new Error("read failed"), { code: "ECONNRESET" }),
  ])("keeps an outage retryable without asking for another version: %s", async (cause) => {
    readObjectBounded.mockRejectedValue(cause);
    expect(await approve()).toEqual({
      success: false, code: "storage_unavailable",
      error: "Version 1 of the GHG Statement report could not be checked because storage is unavailable. Try again.",
    });
    expect(report.lifecycle).toBe("prepared");
    expect(approveRow).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ reportId: REPORT_ID, documentId: REPORT_DOCUMENT_ID, check: "stored object read", storageErrorCode: cause.code }, expect.any(String));
  });

  it("treats a missing object as a stored file failure", async () => {
    readObjectBounded.mockResolvedValue(null);
    expect(await approve()).toMatchObject({ code: "report_verification_failed", error: "Version 1 of the GHG Statement report failed the stored file check. Prepare a new report." });
  });

  it("rejects an oversized replacement at the read limit", async () => {
    readObjectBounded.mockRejectedValue(new StorageError("secret URL", "object_too_large"));
    expect(await approve()).toMatchObject({ code: "report_verification_failed", error: "Version 1 of the GHG Statement report failed the file size check. Prepare a new report." });
    expect(logger.warn).toHaveBeenCalledWith({ reportId: REPORT_ID, documentId: REPORT_DOCUMENT_ID, check: "byte size", storageErrorCode: "object_too_large" }, expect.any(String));
    expect(approveRow).not.toHaveBeenCalled();
  });

  it("asks for storage setup when the provider cannot be configured", async () => {
    vi.spyOn(storageModule, "getStorageProvider").mockImplementation(() => { throw new Error("private config"); });
    expect(await approve()).toMatchObject({ code: "storage_not_configured", error: "Version 1 of the GHG Statement report could not be checked because storage is not configured. Contact a Platform Admin to configure storage." });
    expect(readObjectBounded).not.toHaveBeenCalled();
    expect(approveRow).not.toHaveBeenCalled();
  });

  it("fails closed when the document is unavailable in the active Organization", async () => {
    vi.mocked(getDocumentById).mockResolvedValue(null);
    expect(await approve()).toMatchObject({ success: false, code: "report_verification_failed", error: expect.stringContaining("stored file") });
    expect(readObjectBounded).not.toHaveBeenCalled();
  });

  it("approves intact bytes read using the org-scoped document key", async () => {
    expect(await approve()).toMatchObject({ success: true, data: { lifecycle: "approved" } });
    expect(getDocumentById).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-test" }), REPORT_DOCUMENT_ID);
    expect(readObjectBounded).toHaveBeenCalledExactlyOnceWith({ key: STORAGE_KEY, maxBytes: 4, signal: expect.any(AbortSignal) });
  });
});
