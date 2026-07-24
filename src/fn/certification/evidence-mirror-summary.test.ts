import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";

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
    vi.mocked(getSamplesByCreditBatchIds).mockResolvedValue([
      { id: "sample-1" },
    ] as never);
    vi.mocked(getTransportLegsForEntities).mockImplementation(
      async (_ctx, entityType) =>
        entityType === "feedstock"
          ? ([{ id: "feedstock-leg-1" }] as never)
          : entityType === "biochar"
            ? ([{ id: "biochar-leg-1" }] as never)
            : ([{ id: "sample-leg-1" }] as never),
    );
    vi.mocked(listDocumentsForEntityIds).mockImplementation(
      async (_ctx, entityType) => {
        if (entityType === "application") return [{ id: "document-1" }] as never;
        if (entityType === "transport_leg") {
          return [{ id: "document-2" }] as never;
        }
        return [];
      },
    );
    vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([
      { documentId: "document-2" },
    ] as never);
  });

  it("reuses the resolved scope and batches document reads by entity type", async () => {
    await expect(
      loadEvidenceMirrorSummaryForScope(orgCtx, {
        removalId: "removal-1",
        memberBatches: [{ id: "batch-1" }],
        lineages: [lineage],
      }),
    ).resolves.toEqual({ total: 2, mirrored: 1 });

    expect(getSamplesByCreditBatchIds).toHaveBeenCalledWith(orgCtx, ["batch-1"]);
    expect(getTransportLegsForEntities).toHaveBeenCalledTimes(3);
    expect(listDocumentsForEntityIds).toHaveBeenCalledTimes(10);
    expect(
      vi.mocked(listDocumentsForEntityIds).mock.calls.map((call) => call[1]),
    ).toEqual(
      expect.arrayContaining([
        "credit_batch",
        "application",
        "delivery",
        "order",
        "biochar_product",
        "production_run",
        "reactor",
        "feedstock",
        "sample",
        "transport_leg",
      ]),
    );
    expect(listDocumentUploadsForDocuments).toHaveBeenCalledWith(
      orgCtx,
      "isometric",
      ["document-1", "document-2"],
    );
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
