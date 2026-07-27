/**
 * Documents Server Actions Tests
 *
 * Covers requestUpload → confirmUpload happy path, oversize rejection,
 * content-type mismatch rejection, and unauth gating. Uses an injected
 * fake StorageProvider via __setStorageProviderForTests so no real S3
 * or filesystem is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { DOCUMENT_UPLOAD_MAX_BYTES } from "@/lib/documents/upload-policy";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(),
}));

vi.mock("@/data-access/documents", () => ({
  assertCanManageDocumentEntity: vi.fn(),
  insertDocument: vi.fn(),
  getDocumentById: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocumentRow: vi.fn(),
  deleteDocumentWithCertificationSafety: vi.fn(),
  listDocumentsForEntity: vi.fn(),
}));

import { requireOrgContext } from "@/lib/auth/server";
import {
  insertDocument,
  getDocumentById,
  updateDocument,
  assertCanManageDocumentEntity,
  deleteDocumentWithCertificationSafety,
} from "@/data-access/documents";
import {
  confirmUpload,
  deleteDocument,
  requestUpload,
  updateApplicationEvidenceMetadata,
} from "@/fn/documents";
import { __setStorageProviderForTests } from "@/lib/storage";
import type {
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from "@/lib/storage";

const mockUser = {
  id: "user-123",
  email: "test@example.com",
  name: "Test",
  emailVerified: true,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const TEST_CTX = makeTestOrgContext(mockUser.id);

class FakeProvider implements StorageProvider {
  readonly name = "local-fs" as const;
  readonly bucket = "local-fs";
  readonly store = new Map<string, { size: number; contentType: string }>();
  readonly deleted: string[] = [];

  async createUploadUrl(args: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedUpload> {
    return {
      url: `https://fake.test/${encodeURIComponent(args.key)}`,
      method: "PUT",
      headers: { "Content-Type": args.contentType },
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
  async createDownloadUrl(args: { key: string }): Promise<string> {
    return `https://fake.test/${encodeURIComponent(args.key)}?download=1`;
  }
  async headObject(key: string): Promise<ObjectHead | null> {
    const obj = this.store.get(key);
    if (!obj) return null;
    return { size: obj.size, contentType: obj.contentType, etag: "etag" };
  }
  async deleteObject(key: string): Promise<void> {
    this.store.delete(key);
    this.deleted.push(key);
  }
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.store.set(key, { size: body.byteLength, contentType });
  }
  // Test helper
  simulatePut(key: string, size: number, contentType: string) {
    this.store.set(key, { size, contentType });
  }
}

let provider: FakeProvider;

beforeEach(() => {
  vi.clearAllMocks();
  provider = new FakeProvider();
  __setStorageProviderForTests(provider);
  vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);
});

afterEach(() => {
  __setStorageProviderForTests(null);
});

const baseInput = {
  entityType: "sample",
  entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  documentType: "lab_report" as const,
  fileName: "report.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
};

const photoInput = {
  entityType: "application",
  entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  documentType: "photo" as const,
  fileName: "application-field.jpg",
  contentType: "image/jpeg",
  sizeBytes: 1024,
};

const productionRunCsvInput = {
  entityType: "production_run",
  entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  documentType: "sensor_data" as const,
  fileName: "TZ001B 2026-04-02 Data Evaluation.csv",
  contentType: "text/csv",
  sizeBytes: 1024,
};

describe("requestUpload", () => {
  it("returns Unauthorized when user is not signed in", async () => {
    vi.mocked(requireOrgContext).mockRejectedValueOnce(
      new SafeError("Select an organization to continue."),
    );
    const result = await requestUpload(baseInput);
    expect(result).toEqual({
      success: false,
      error: "Select an organization to continue.",
    });
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("rejects content-type not in allowlist", async () => {
    const result = await requestUpload({
      ...baseInput,
      contentType: "text/html",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not allowed/);
    }
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("rejects a file one byte over the 10 MB cap", async () => {
    const result = await requestUpload({
      ...baseInput,
      sizeBytes: DOCUMENT_UPLOAD_MAX_BYTES + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/exceeds/);
    }
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the 10 MB cap", async () => {
    vi.mocked(insertDocument).mockResolvedValueOnce({
      id: "11111111-2222-4333-8444-555555555555",
      uploadStatus: "pending",
    } as never);

    const result = await requestUpload({
      ...baseInput,
      sizeBytes: DOCUMENT_UPLOAD_MAX_BYTES,
    });

    expect(result.success).toBe(true);
  });

  it("inserts pending row and returns presigned URL on happy path", async () => {
    vi.mocked(insertDocument).mockResolvedValueOnce({
      id: "11111111-2222-4333-8444-555555555555",
      uploadStatus: "pending",
    } as never);

    const result = await requestUpload(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentId).toBe("11111111-2222-4333-8444-555555555555");
      expect(result.data.uploadUrl).toMatch(/^https:\/\/fake\.test\//);
      expect(result.data.storageKey).toMatch(
        /^org\/org_test_fixtures\/sample\/.*\/lab_report\//,
      );
    }
    expect(insertDocument).toHaveBeenCalledWith(
      TEST_CTX,
      expect.objectContaining({
        entityType: "sample",
        documentType: "lab_report",
        uploadStatus: "pending",
        visibility: "private",
        storageProvider: "local-fs",
      })
    );
  });

  it("allows production-run CSV uploads after checking the target run", async () => {
    vi.mocked(insertDocument).mockResolvedValueOnce({
      id: "11111111-2222-4333-8444-555555555555",
      uploadStatus: "pending",
    } as never);

    const result = await requestUpload(productionRunCsvInput);

    expect(result.success).toBe(true);
    expect(assertCanManageDocumentEntity).toHaveBeenCalledWith(
      TEST_CTX,
      "production_run",
      productionRunCsvInput.entityId,
    );
    expect(insertDocument).toHaveBeenCalledWith(
      TEST_CTX,
      expect.objectContaining({
        entityType: "production_run",
        documentType: "sensor_data",
        mimeType: "text/csv",
      }),
    );
  });

  it("accepts application photos without EXIF timestamp or GPS and flags the gap", async () => {
    vi.mocked(insertDocument).mockResolvedValueOnce({
      id: "11111111-2222-4333-8444-555555555555",
      uploadStatus: "pending",
    } as never);

    const result = await requestUpload(photoInput);

    expect(result.success).toBe(true);
    expect(insertDocument).toHaveBeenCalledWith(
      TEST_CTX,
      expect.objectContaining({
        entityType: "application",
        documentType: "photo",
        capturedAt: null,
        metadata: expect.objectContaining({
          geotagStatus: "missing",
          missingExif: expect.arrayContaining(["gps", "timestamp"]),
        }),
      }),
    );
  });
});

describe("confirmUpload", () => {
  const pendingRow = {
    id: "11111111-2222-4333-8444-555555555555",
    entityType: "sample",
    entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    documentType: "lab_report" as const,
    storageKey: "sample/abc/lab_report/01.pdf",
    fileName: "report.pdf",
    uploadStatus: "pending" as const,
    visibility: "private" as const,
    storageProvider: "fake",
    storageBucket: "test",
    fileSizeBytes: 1024,
    mimeType: "application/pdf",
  };

  it("flips row to uploaded when head verifies", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(pendingRow as never);
    provider.simulatePut(
      pendingRow.storageKey,
      DOCUMENT_UPLOAD_MAX_BYTES,
      "application/pdf",
    );
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...pendingRow,
      uploadStatus: "uploaded",
    } as never);

    const result = await confirmUpload({ documentId: pendingRow.id });

    expect(result.success).toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(
      TEST_CTX,
      pendingRow.id,
      expect.objectContaining({
        uploadStatus: "uploaded",
        fileSizeBytes: DOCUMENT_UPLOAD_MAX_BYTES,
        mimeType: "application/pdf",
      })
    );
    expect(provider.deleted).toEqual([]);
  });

  it("rejects and deletes oversized objects", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(pendingRow as never);
    provider.simulatePut(
      pendingRow.storageKey,
      DOCUMENT_UPLOAD_MAX_BYTES + 1,
      "application/pdf",
    );
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...pendingRow,
      uploadStatus: "failed",
    } as never);

    const result = await confirmUpload({ documentId: pendingRow.id });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/exceeds/);
    }
    expect(provider.deleted).toContain(pendingRow.storageKey);
    expect(updateDocument).toHaveBeenCalledWith(
      TEST_CTX,
      pendingRow.id,
      { uploadStatus: "failed" }
    );
  });

  it("rejects and deletes objects with wrong content-type", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(pendingRow as never);
    provider.simulatePut(pendingRow.storageKey, 1024, "text/html");
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...pendingRow,
      uploadStatus: "failed",
    } as never);

    const result = await confirmUpload({ documentId: pendingRow.id });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not allowed/);
    }
    expect(provider.deleted).toContain(pendingRow.storageKey);
  });

  it("fails when object not present in storage", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(pendingRow as never);
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...pendingRow,
      uploadStatus: "failed",
    } as never);

    const result = await confirmUpload({ documentId: pendingRow.id });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found in storage/);
    }
  });

  it("refuses to re-confirm a non-pending row", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      ...pendingRow,
      uploadStatus: "uploaded",
    } as never);

    const result = await confirmUpload({ documentId: pendingRow.id });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already in/);
    }
  });

  it("returns Unauthorized when user is not signed in", async () => {
    vi.mocked(requireOrgContext).mockRejectedValueOnce(
      new SafeError("Select an organization to continue."),
    );
    const result = await confirmUpload({ documentId: pendingRow.id });
    expect(result).toEqual({
      success: false,
      error: "Select an organization to continue.",
    });
  });
});

describe("updateApplicationEvidenceMetadata", () => {
  const uploadedApplicationPhoto = {
    id: "11111111-2222-4333-8444-555555555555",
    entityType: "application",
    entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    documentType: "photo" as const,
    uploadStatus: "uploaded" as const,
    metadata: {
      geotagStatus: "present",
      missingExif: [],
      exif: {
        capturedAt: "2026-06-14T12:00:00.000Z",
        gps: { latitude: 1, longitude: 2 },
      },
    },
  };
  const uploadedApplicationPdf = {
    ...uploadedApplicationPhoto,
    documentType: "pdf" as const,
    metadata: {
      source: "legacy-upload",
    },
  };

  it("classifies legacy application photos without replacing EXIF metadata", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      uploadedApplicationPhoto as never,
    );
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...uploadedApplicationPhoto,
      metadata: {
        ...uploadedApplicationPhoto.metadata,
        evidenceRole: "stockpile",
      },
    } as never);

    const result = await updateApplicationEvidenceMetadata({
      documentId: uploadedApplicationPhoto.id,
      applicationEvidenceRole: "stockpile",
    });

    expect(result.success).toBe(true);
    expect(assertCanManageDocumentEntity).toHaveBeenCalledWith(
      TEST_CTX,
      "application",
      uploadedApplicationPhoto.entityId,
    );
    expect(updateDocument).toHaveBeenCalledWith(
      TEST_CTX,
      uploadedApplicationPhoto.id,
      {
        metadata: {
          ...uploadedApplicationPhoto.metadata,
          evidenceRole: "stockpile",
        },
      },
    );
  });

  it("rejects evidence role classification for non-photo documents", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce({
      ...uploadedApplicationPhoto,
      documentType: "pdf",
      metadata: {},
    } as never);

    const result = await updateApplicationEvidenceMetadata({
      documentId: uploadedApplicationPhoto.id,
      applicationEvidenceRole: "stockpile",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/only be set on photos/);
    }
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("classifies legacy application PDFs as typed boundary logbook evidence", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      uploadedApplicationPdf as never,
    );
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...uploadedApplicationPdf,
      metadata: {
        source: "legacy-upload",
        logbookEvidenceType: "inventory",
      },
    } as never);

    const result = await updateApplicationEvidenceMetadata({
      documentId: uploadedApplicationPdf.id,
      applicationLogbookEvidenceType: "inventory",
    });

    expect(result.success).toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(
      TEST_CTX,
      uploadedApplicationPdf.id,
      {
        metadata: {
          source: "legacy-upload",
          logbookEvidenceType: "inventory",
        },
      },
    );
  });
});

describe("deleteDocument", () => {
  const owningRecordDocument = {
    id: "11111111-2222-4333-8444-555555555555",
    entityType: "feedstock",
    entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    storageKey: "feedstock/evidence.pdf",
  };

  it("deletes owning-record evidence through certification-safe retirement", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      owningRecordDocument as never,
    );
    vi.mocked(deleteDocumentWithCertificationSafety).mockResolvedValueOnce(
      owningRecordDocument as never,
    );

    const result = await deleteDocument({
      documentId: owningRecordDocument.id,
    });

    expect(result).toEqual({
      success: true,
      data: { id: owningRecordDocument.id },
    });
    expect(assertCanManageDocumentEntity).toHaveBeenCalledWith(
      TEST_CTX,
      "feedstock",
      owningRecordDocument.entityId,
    );
    expect(deleteDocumentWithCertificationSafety).toHaveBeenCalledWith(
      TEST_CTX,
      owningRecordDocument.id,
    );
  });

  it("surfaces submitted-history deletion refusal from the safety boundary", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      owningRecordDocument as never,
    );
    vi.mocked(deleteDocumentWithCertificationSafety).mockRejectedValueOnce(
      new SafeError(
        "This document belongs to submitted certification history and cannot be deleted or replaced.",
      ),
    );

    const result = await deleteDocument({
      documentId: owningRecordDocument.id,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/submitted certification history/i);
  });
});
