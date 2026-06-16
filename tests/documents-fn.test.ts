/**
 * Documents Server Actions Tests
 *
 * Covers requestUpload → confirmUpload happy path, oversize rejection,
 * content-type mismatch rejection, and unauth gating. Uses an injected
 * fake StorageProvider via __setStorageProviderForTests so no real S3
 * or filesystem is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn(),
}));

vi.mock("@/data-access/documents", () => ({
  assertCanManageDocumentEntity: vi.fn(),
  insertDocument: vi.fn(),
  getDocumentById: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocumentRow: vi.fn(),
  listDocumentsForEntity: vi.fn(),
}));

import { getUser } from "@/lib/auth/server";
import {
  insertDocument,
  getDocumentById,
  updateDocument,
  assertCanManageDocumentEntity,
} from "@/data-access/documents";
import {
  confirmUpload,
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
  vi.mocked(getUser).mockResolvedValue(mockUser);
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
    vi.mocked(getUser).mockResolvedValueOnce(null);
    const result = await requestUpload(baseInput);
    expect(result).toEqual({ success: false, error: "Unauthorized" });
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

  it("rejects size over per-documentType cap", async () => {
    const result = await requestUpload({
      ...baseInput,
      sizeBytes: 200 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/exceeds/);
    }
    expect(insertDocument).not.toHaveBeenCalled();
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
      expect(result.data.storageKey).toMatch(/^sample\/.*\/lab_report\//);
    }
    expect(insertDocument).toHaveBeenCalledWith(
      mockUser.id,
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
      mockUser.id,
      "production_run",
      productionRunCsvInput.entityId,
    );
    expect(insertDocument).toHaveBeenCalledWith(
      mockUser.id,
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
      mockUser.id,
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
    provider.simulatePut(pendingRow.storageKey, 1024, "application/pdf");
    vi.mocked(updateDocument).mockResolvedValueOnce({
      ...pendingRow,
      uploadStatus: "uploaded",
    } as never);

    const result = await confirmUpload({ documentId: pendingRow.id });

    expect(result.success).toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(
      mockUser.id,
      pendingRow.id,
      expect.objectContaining({
        uploadStatus: "uploaded",
        fileSizeBytes: 1024,
        mimeType: "application/pdf",
      })
    );
    expect(provider.deleted).toEqual([]);
  });

  it("rejects and deletes oversized objects", async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(pendingRow as never);
    // lab_report cap is 50MB; put 60MB instead.
    provider.simulatePut(pendingRow.storageKey, 60 * 1024 * 1024, "application/pdf");
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
      mockUser.id,
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
    vi.mocked(getUser).mockResolvedValueOnce(null);
    const result = await confirmUpload({ documentId: pendingRow.id });
    expect(result).toEqual({ success: false, error: "Unauthorized" });
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
      mockUser.id,
      "application",
      uploadedApplicationPhoto.entityId,
    );
    expect(updateDocument).toHaveBeenCalledWith(
      mockUser.id,
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
      mockUser.id,
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
