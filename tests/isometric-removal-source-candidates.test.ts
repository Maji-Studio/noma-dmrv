import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/lib/auth/server", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/documents");
vi.mock("@/data-access/certifier-document-uploads");
vi.mock("@/data-access/credit-batch-samples", () => ({
  getSamplesByCreditBatchIds: vi.fn(),
}));
vi.mock("@/data-access/transport-legs", () => ({
  getTransportLegsForEntities: vi.fn(),
}));

import * as documentsDA from "@/data-access/documents";
import {
  collectCandidateSourceDocumentsForRemoval,
  resolveSourceBindingCandidates,
} from "@/fn/certification/sources";
import * as uploadsDA from "@/data-access/certifier-document-uploads";

const orgCtx = makeTestOrgContext("user-1");
const lineages = [
  {
    application: { id: "application-1", code: "APP-001" },
    delivery: { id: "delivery-1", code: "DEL-001" },
    order: null,
    biocharProduct: null,
    productionRun: { id: "run-1", code: "PR-001" },
    reactor: null,
    feedstocks: [{ id: "feedstock-1", code: "FS-001" }],
  },
];

describe("Removal source candidate discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentsDA.listDocumentsForEntity).mockImplementation(
      async (_ctx, entityType) => {
        if (entityType === "application") {
          return [
            {
              id: "inventory-document",
              documentType: "pdf",
              metadata: { logbookEvidenceType: "inventory" },
            },
            {
              id: "weighbridge-document",
              documentType: "pdf",
              metadata: { logbookEvidenceType: "weighbridge" },
            },
            {
              id: "affidavit-document",
              documentType: "affidavit",
              metadata: {},
            },
            {
              id: "application-photo",
              documentType: "photo",
              metadata: { evidenceRole: "spreading" },
            },
          ] as never;
        }
        if (entityType === "feedstock") {
          return [
            {
              id: "feedstock-bol",
              documentType: "bill_of_lading",
              metadata: {},
            },
          ] as never;
        }
        if (entityType === "delivery") {
          return [
            {
              id: "delivery-bol",
              documentType: "bill_of_lading",
              metadata: {},
            },
          ] as never;
        }
        if (entityType === "production_run") {
          return [
            {
              id: "readings-csv",
              documentType: "sensor_data",
              metadata: {},
            },
          ] as never;
        }
        return [] as never;
      },
    );
  });

  it("returns only the three code-owned role candidates", async () => {
    const candidates = await collectCandidateSourceDocumentsForRemoval(
      orgCtx,
      { lineages },
    );

    expect(candidates.map((candidate) => candidate.documentId)).toEqual([
      "affidavit-document",
      "delivery-bol",
      "feedstock-bol",
      "inventory-document",
      "weighbridge-document",
    ]);
    expect(candidates.map((candidate) => candidate.binding.nomaRole).sort()).toEqual([
      "delivery_bill_of_lading",
      "feedstock_bill_of_lading",
      "inventory",
      "inventory",
      "inventory",
    ]);
    expect(documentsDA.listDocumentsForEntity).not.toHaveBeenCalledWith(
      orgCtx,
      "production_run",
      "run-1",
    );
  });

  it("resolves persisted Source IDs without losing their intended targets", async () => {
    vi.mocked(uploadsDA.listDocumentUploadsForDocuments).mockResolvedValue([
      {
        documentId: "inventory-document",
        externalDocumentId: "src-inventory",
      },
      {
        documentId: "feedstock-bol",
        externalDocumentId: "src-feedstock",
      },
    ] as never);
    const candidates = await collectCandidateSourceDocumentsForRemoval(
      orgCtx,
      { lineages },
    );

    await expect(
      resolveSourceBindingCandidates(orgCtx, { candidates }),
    ).resolves.toMatchObject([
      {
        documentId: "feedstock-bol",
        sourceId: "src-feedstock",
        binding: {
          intendedTarget: {
            groupKey: "biomass-feedstock-transport",
            inputKey: "mass_distance",
          },
        },
      },
      {
        documentId: "inventory-document",
        sourceId: "src-inventory",
        binding: {
          intendedTarget: {
            groupKey: "co2-stored",
            inputKey: "product_mass",
          },
        },
      },
    ]);
  });

  it("includes generated transport and durability ledgers attached to member credit batches", async () => {
    vi.mocked(documentsDA.listDocumentsForEntity).mockImplementation(
      async (_ctx, entityType) => {
        if (entityType !== "credit_batch") return [] as never;
        return [
          {
            id: "transport-ledger",
            documentType: "pdf",
            metadata: {
              kind: "transport_evidence_ledger",
              removalId: "removal-1",
              contentHash: "transport-hash",
            },
          },
          {
            id: "durability-ledger",
            documentType: "pdf",
            metadata: {
              kind: "durability_evidence_ledger",
              removalId: "removal-1",
              contentHash: "durability-hash",
              durabilityOption: "1000_year",
            },
          },
          {
            id: "other-removal-ledger",
            documentType: "pdf",
            metadata: {
              kind: "transport_evidence_ledger",
              removalId: "removal-2",
              contentHash: "other-hash",
            },
          },
        ] as never;
      },
    );

    const candidates = await collectCandidateSourceDocumentsForRemoval(
      orgCtx,
      {
        removalId: "removal-1",
        lineages,
        memberBatches: [{ id: "credit-batch-1", code: "CB-001" }],
      },
    );

    expect(candidates.map((candidate) => candidate.documentId)).toEqual([
      "durability-ledger",
      "transport-ledger",
    ]);
    expect(candidates.map((candidate) => candidate.binding.nomaRole)).toEqual([
      "durability_evidence_ledger",
      "transport_evidence_ledger",
    ]);
  });
});
