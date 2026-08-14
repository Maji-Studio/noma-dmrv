import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { StorageError } from "@/lib/storage/types";

const mocks = vi.hoisted(() => ({
  getObject: vi.fn(),
  getImportContext: vi.fn(),
  insertReadings: vi.fn(),
  recordOutcome: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  getStorageProvider: vi.fn(() => ({ getObject: mocks.getObject })),
}));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(async () => ({
    userId: "user-storage-read",
    organizationId: "org-storage-read",
    orgRole: "owner",
    isPlatformAdmin: false,
  })),
}));
vi.mock("@/data-access/production-run-reading-imports", () => ({
  getProductionRunReadingsImportContext: mocks.getImportContext,
  insertProductionRunReadingsSkippingDuplicates: mocks.insertReadings,
  recordReadingsImportOutcome: mocks.recordOutcome,
}));

import { downloadDocumentBlob } from "@/fn/certification/sources-transfer";
import { importProductionRunReadingsFromDocumentFn } from "@/fn/production-run-reading-imports";

const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const STORAGE_KEY = "org/org-storage-read/production-run/readings.csv";
const READINGS_ERROR =
  "The uploaded readings file could not be read. Upload it again and retry the import.";
const SOURCE_ERROR =
  "The supporting document could not be read. Upload the file again and retry the submission.";
const READ_FAILURES = [
  new StorageError("status 503", "get_object_failed"),
  new StorageError("timed out", "get_object_timeout"),
  new TypeError("transport failed"),
];

const document = {
  id: DOCUMENT_ID,
  fileName: "evidence.pdf",
  documentType: "pdf",
  mimeType: "application/pdf",
  fileSizeBytes: 12,
  storageKey: STORAGE_KEY,
  capturedAt: null,
  createdAt: new Date("2026-01-05T00:00:00Z"),
  checksumSha256: null,
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getImportContext.mockResolvedValue({
    documentId: DOCUMENT_ID,
    fileName: "readings.csv",
    storageKey: STORAGE_KEY,
    mimeType: "text/csv",
    productionRunId: "33333333-3333-4333-8333-333333333333",
    runCode: "RUN-001",
    runDate: "2026-01-05",
    runWindowStart: new Date("2026-01-05T00:00:00Z"),
    runWindowEnd: new Date("2026-01-05T01:00:00Z"),
  });
  mocks.recordOutcome.mockResolvedValue(undefined);
});

describe("stored-object read call sites", () => {
  it.each(READ_FAILURES)(
    "keeps the readings import message for provider failure %#",
    async (failure) => {
      mocks.getObject.mockRejectedValue(failure);

      const result = await importProductionRunReadingsFromDocumentFn({
        documentId: DOCUMENT_ID,
      });

      expect(result).toEqual({ success: false, error: READINGS_ERROR });
      expect(mocks.getObject).toHaveBeenCalledWith({ key: STORAGE_KEY });
      expect(mocks.recordOutcome).toHaveBeenCalledWith(
        expect.any(Object),
        DOCUMENT_ID,
        { status: "failed", error: READINGS_ERROR },
      );
    },
  );

  it("builds the certification blob from provider bytes and content type", async () => {
    mocks.getObject.mockResolvedValue({
      bytes: Buffer.from("pdf bytes"),
      contentType: "application/pdf",
    });

    const result = await downloadDocumentBlob(document as never);

    expect(mocks.getObject).toHaveBeenCalledWith({ key: STORAGE_KEY });
    expect(result.contentType).toBe("application/pdf");
    expect(await result.blob.text()).toBe("pdf bytes");
  });

  it.each(READ_FAILURES)(
    "keeps the certification message for provider failure %#",
    async (failure) => {
      mocks.getObject.mockRejectedValue(failure);

      await expect(downloadDocumentBlob(document as never)).rejects.toEqual(
        new SafeError(SOURCE_ERROR),
      );
    },
  );
});
