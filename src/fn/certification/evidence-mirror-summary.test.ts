import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";

const storageMocks = vi.hoisted(() => ({
  headObject: vi.fn(),
}));

vi.mock("@/data-access/credit-batch-samples", () => ({
  getSamplesByCreditBatchIds: vi.fn(),
}));
vi.mock("@/data-access/certifier-document-uploads", () => ({
  listDocumentUploadsForDocuments: vi.fn(),
}));
vi.mock("@/data-access/documents", () => ({
  listDocumentsForEntityIds: vi.fn(),
}));
vi.mock("@/data-access/transport-legs", () => ({
  getTransportLegsForEntities: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  getStorageProvider: () => ({ headObject: storageMocks.headObject }),
}));

import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { listDocumentUploadsForDocuments } from "@/data-access/certifier-document-uploads";
import { listDocumentsForEntityIds } from "@/data-access/documents";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadEvidenceMirrorSummaryForScope } from "./evidence-mirror-summary";

const orgCtx = {
  organizationId: "org",
  userId: "user",
  orgRole: "admin" as const,
  isPlatformAdmin: false,
};

const lineage = {
  application: { id: "application-1" },
  delivery: { id: "delivery-1" },
  order: { id: "order-1" },
  biocharProduct: { id: "biochar-product-1" },
  productionRun: { id: "production-run-1" },
  reactor: { id: "reactor-1" },
  feedstocks: [{ id: "feedstock-1" }],
} as unknown as ChainOfCustodyData;

describe("loadEvidenceMirrorSummaryForScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.headObject.mockResolvedValue({
      size: 1_024,
      contentType: "application/pdf",
      etag: "etag",
    });
    vi.mocked(listDocumentsForEntityIds).mockImplementation(
      async (_ctx, entityType) => {
        if (entityType === "application") {
          return [
            {
              id: "document-1",
              entityType: "application",
              entityId: "application-1",
              documentType: "pdf",
              metadata: { logbookEvidenceType: "inventory" },
              storageKey: "managed/document-1",
              uploadStatus: "uploaded",
              fileSizeBytes: 1_024,
              mimeType: "application/pdf",
            },
          ] as never;
        }
        if (entityType === "feedstock") {
          return [
            {
              id: "document-2",
              entityType: "feedstock",
              entityId: "feedstock-1",
              documentType: "bill_of_lading",
              metadata: {},
              storageKey: "managed/document-2",
              uploadStatus: "uploaded",
              fileSizeBytes: 1_024,
              mimeType: "application/pdf",
            },
          ] as never;
        }
        if (entityType === "delivery") {
          return [
            {
              id: "document-3",
              entityType: "delivery",
              entityId: "delivery-1",
              documentType: "bill_of_lading",
              metadata: {},
              storageKey: "managed/document-3",
              uploadStatus: "uploaded",
              fileSizeBytes: 1_024,
              mimeType: "application/pdf",
            },
          ] as never;
        }
        if (entityType === "production_run") {
          return [
            {
              id: "readings-csv",
              entityType: "production_run",
              entityId: "production-run-1",
              documentType: "sensor_data",
              metadata: {},
              storageKey: "managed/readings.csv",
              uploadStatus: "uploaded",
              fileSizeBytes: 1_024,
              mimeType: "text/csv",
            },
          ] as never;
        }
        return [];
      },
    );
    vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([
      { documentId: "document-2" },
      { documentId: "document-3" },
    ] as never);
  });

  it("counts only the three code-owned role candidates and excludes telemetry", async () => {
    await expect(
      loadEvidenceMirrorSummaryForScope(orgCtx, {
        removalId: "removal-1",
        memberBatches: [{ id: "batch-1" }],
        lineages: [lineage],
      }),
    ).resolves.toEqual({ total: 3, mirrored: 2 });

    expect(getSamplesByCreditBatchIds).not.toHaveBeenCalled();
    expect(getTransportLegsForEntities).not.toHaveBeenCalled();
    expect(listDocumentsForEntityIds).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(listDocumentsForEntityIds).mock.calls.map((call) => call[1]),
    ).toEqual(expect.arrayContaining(["application", "delivery", "feedstock"]));
    expect(listDocumentUploadsForDocuments).toHaveBeenCalledWith(
      orgCtx,
      "isometric",
      ["document-1", "document-3", "document-2"],
    );
  });

  it("counts only completed managed uploads in the mirror denominator", async () => {
    vi.mocked(listDocumentsForEntityIds).mockImplementation(
      async (_ctx, entityType) =>
        entityType === "application"
          ? ([
              {
                id: "managed",
                entityType: "application",
                entityId: "application-1",
                documentType: "pdf",
                metadata: { logbookEvidenceType: "inventory" },
                storageKey: "managed/document.pdf",
                uploadStatus: "uploaded",
                fileSizeBytes: 1_024,
                mimeType: "application/pdf",
              },
              {
                id: "metadata-only",
                entityType: "application",
                entityId: "application-1",
                documentType: "pdf",
                metadata: { logbookEvidenceType: "inventory" },
                storageKey: null,
                uploadStatus: "uploaded",
              },
              {
                id: "pending",
                entityType: "application",
                entityId: "application-1",
                documentType: "pdf",
                metadata: { logbookEvidenceType: "inventory" },
                storageKey: "managed/pending.pdf",
                uploadStatus: "pending",
              },
              {
                id: "failed",
                entityType: "application",
                entityId: "application-1",
                documentType: "pdf",
                metadata: { logbookEvidenceType: "inventory" },
                storageKey: "managed/failed.pdf",
                uploadStatus: "failed",
              },
            ] as never)
          : [],
    );
    vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([]);

    await expect(
      loadEvidenceMirrorSummaryForScope(orgCtx, {
        removalId: "removal-1",
        memberBatches: [{ id: "batch-1" }],
        lineages: [lineage],
      }),
    ).resolves.toEqual({ total: 1, mirrored: 0 });

    expect(listDocumentUploadsForDocuments).toHaveBeenCalledWith(
      orgCtx,
      "isometric",
      ["managed"],
    );
  });

  it("counts application-only Biochar Application Source candidates", async () => {
    vi.mocked(listDocumentsForEntityIds).mockImplementation(
      async (_ctx, entityType) =>
        entityType === "application"
          ? ([
              {
                id: "application-photo",
                entityType: "application",
                entityId: "application-1",
                documentType: "photo",
                metadata: {},
                storageKey: "managed/application-photo.jpg",
                uploadStatus: "uploaded",
                fileSizeBytes: 1_024,
                mimeType: "image/jpeg",
              },
            ] as never)
          : [],
    );
    vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([]);

    await expect(
      loadEvidenceMirrorSummaryForScope(orgCtx, {
        removalId: "removal-1",
        memberBatches: [{ id: "batch-1" }],
        lineages: [lineage],
      }),
    ).resolves.toEqual({ total: 1, mirrored: 0 });

    expect(listDocumentUploadsForDocuments).toHaveBeenCalledWith(
      orgCtx,
      "isometric",
      ["application-photo"],
    );
  });

  it("excludes uploaded rows whose storage object is missing", async () => {
    storageMocks.headObject.mockResolvedValueOnce(null);
    vi.mocked(listDocumentsForEntityIds).mockImplementation(
      async (_ctx, entityType) =>
        entityType === "application"
          ? ([
              {
                id: "missing-object",
                entityType: "application",
                entityId: "application-1",
                documentType: "pdf",
                metadata: { logbookEvidenceType: "inventory" },
                storageKey: "managed/missing.pdf",
                uploadStatus: "uploaded",
                fileSizeBytes: 1_024,
                mimeType: "application/pdf",
              },
            ] as never)
          : [],
    );
    vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([]);

    await expect(
      loadEvidenceMirrorSummaryForScope(orgCtx, {
        removalId: "removal-1",
        memberBatches: [{ id: "batch-1" }],
        lineages: [lineage],
      }),
    ).resolves.toEqual({ total: 0, mirrored: 0 });

    expect(storageMocks.headObject).toHaveBeenCalledWith("managed/missing.pdf");
  });

  it("returns an empty summary for an unpersisted removal scope", async () => {
    await expect(
      loadEvidenceMirrorSummaryForScope(orgCtx, {
        removalId: null,
        memberBatches: [{ id: "batch-1" }],
        lineages: [lineage],
      }),
    ).resolves.toEqual({ total: 0, mirrored: 0 });

    expect(getSamplesByCreditBatchIds).not.toHaveBeenCalled();
    expect(listDocumentsForEntityIds).not.toHaveBeenCalled();
  });
});
