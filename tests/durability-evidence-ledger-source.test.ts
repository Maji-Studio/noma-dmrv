import { makeTestOrgContext } from "./helpers/test-org";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalSubmissionContext } from "@/fn/certification/certify-context-core";

const USER = "user-1";
const REMOVAL = "removal-1";
const BATCH = "batch-1";
const FACILITY = "facility-1";

const ledgerDbMocks = vi.hoisted(() => {
  const tx = { execute: vi.fn(async () => ({ rows: [] })) };
  return {
    transaction: vi.fn(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
});

vi.mock("@/db", () => ({
  db: { transaction: ledgerDbMocks.transaction },
}));
vi.mock("@/lib/certification/submission-lock", () => ({
  acquireCertificationArtifactLocksSorted: vi.fn(async () => {}),
}));
vi.mock("@/fn/certification/certify-context-core", () => ({
  loadRemovalSubmissionContext: vi.fn(),
}));
vi.mock("@/lib/certification/evidence-ledger/durability-pdf", () => ({
  renderDurabilityLedgerPdf: vi.fn(async () => Buffer.from("%PDF-fake")),
}));
vi.mock("@/lib/certification/evidence-ledger/durability-build-model", () => ({
  buildDurabilityLedgerModel: vi.fn(() => ({
    memberBatchCodes: "CB-26-001",
    facilityName: "Dark Earth Hub",
    externalProjectId: "prj_TEST",
    generatedAtIso: "2026-07-13T00:00:00.000Z",
    batches: [{ creditBatchId: BATCH }],
    soil: {},
    eligibleBatchCount: 1,
    totalReplicates: 3,
  })),
}));
vi.mock("@/data-access/facilities", () => ({
  getFacilityById: vi.fn(async () => ({ id: FACILITY, name: "Dark Earth Hub" })),
}));
vi.mock("@/data-access/documents", () => ({
  listDocumentsByKindForRemoval: vi.fn(async () => []),
  insertDocument: vi.fn(async (_ctx: unknown, row: Record<string, unknown>) => ({
    ...row,
    id: "doc-new",
  })),
  deleteDocumentRow: vi.fn(async () => null),
}));
vi.mock("@/data-access/certifier-document-uploads", () => ({
  getDocumentUploadByDocument: vi.fn(async () => null),
  deleteDocumentUploadByDocument: vi.fn(async () => {}),
}));
vi.mock("@/fn/certification/sources", () => ({
  mirrorDocumentToSourceForUser: vi.fn(async () => ({
    externalDocumentId: "src-new",
    isPublic: false,
    recovered: false,
  })),
}));

const putObject = vi.fn(async () => {});
const deleteObject = vi.fn(async () => {});
vi.mock("@/lib/storage", () => ({
  getStorageProvider: vi.fn(() => ({
    name: "local-fs",
    bucket: "local-fs",
    putObject,
    deleteObject,
  })),
}));

import {
  deleteDocumentRow,
  listDocumentsByKindForRemoval,
} from "@/data-access/documents";
import { renderDurabilityLedgerPdf } from "@/lib/certification/evidence-ledger/durability-pdf";
import { mirrorDocumentToSourceForUser } from "@/fn/certification/sources";
import { ensureDurabilityEvidenceLedgerSourceFromContext } from "@/fn/certification/durability-evidence-ledger";

function context(args: {
  durabilityOption: "200_year" | "1000_year";
  hasSoilReference: boolean;
}): RemovalSubmissionContext {
  return {
    facilityId: FACILITY,
    removalId: REMOVAL,
    mapping: { externalProjectId: "prj_TEST" },
    memberBatches: [{ id: BATCH, code: "CB-26-001" }],
    batchesWithSamples: [
      {
        creditBatchId: BATCH,
        creditBatchCode: "CB-26-001",
        durabilityOption: args.durabilityOption,
        samples: [],
        runs: [],
      },
    ],
    attributionByRunId: new Map(),
    facilityReferenceSoilTemperature: args.hasSoilReference
      ? {
          declaredSoilTemperatureC: 12,
          effectiveSoilTemperatureC: 12,
          temperatureFloored: false,
          source: "Test reference",
          method: "Test method",
          warnings: [],
        }
      : null,
  } as unknown as RemovalSubmissionContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDocumentsByKindForRemoval).mockResolvedValue([
    {
      id: "doc-old",
      storageKey: "durability-evidence/old.pdf",
      metadata: {
        kind: "durability_evidence_ledger",
        removalId: REMOVAL,
        contentHash: "stale",
      },
    } as never,
  ]);
});

describe("ensureDurabilityEvidenceLedgerSourceFromContext", () => {
  it("generates the ledger for a 200-year facility with a soil reference", async () => {
    const result = await ensureDurabilityEvidenceLedgerSourceFromContext(
      makeTestOrgContext(USER),
      REMOVAL,
      context({ durabilityOption: "200_year", hasSoilReference: true }),
    );

    expect(result).toMatchObject({ status: "created", documentId: "doc-new" });
    expect(renderDurabilityLedgerPdf).toHaveBeenCalledOnce();
    expect(mirrorDocumentToSourceForUser).toHaveBeenCalledOnce();
  });

  it("retires 200-year evidence instead of generating it for a 1000-year facility", async () => {
    const result = await ensureDurabilityEvidenceLedgerSourceFromContext(
      makeTestOrgContext(USER),
      REMOVAL,
      context({ durabilityOption: "1000_year", hasSoilReference: true }),
    );

    expect(result).toEqual({ status: "skipped", reason: "not-200-year" });
    expect(renderDurabilityLedgerPdf).not.toHaveBeenCalled();
    expect(mirrorDocumentToSourceForUser).not.toHaveBeenCalled();
    expect(deleteDocumentRow).toHaveBeenCalledWith(
      makeTestOrgContext(USER),
      "doc-old",
    );
  });

  it("retires stale durability evidence when there are no sampled batches", async () => {
    const ctx = context({ durabilityOption: "200_year", hasSoilReference: true });
    ctx.batchesWithSamples = [];

    const result = await ensureDurabilityEvidenceLedgerSourceFromContext(
      makeTestOrgContext(USER),
      REMOVAL,
      ctx,
    );

    expect(result).toEqual({ status: "skipped", reason: "no-samples" });
    expect(renderDurabilityLedgerPdf).not.toHaveBeenCalled();
    expect(deleteDocumentRow).toHaveBeenCalledWith(
      makeTestOrgContext(USER),
      "doc-old",
    );
  });

  it("retires stale durability evidence when the soil reference is absent", async () => {
    const result = await ensureDurabilityEvidenceLedgerSourceFromContext(
      makeTestOrgContext(USER),
      REMOVAL,
      context({ durabilityOption: "200_year", hasSoilReference: false }),
    );

    expect(result).toEqual({ status: "skipped", reason: "no-soil-reference" });
    expect(renderDurabilityLedgerPdf).not.toHaveBeenCalled();
    expect(deleteDocumentRow).toHaveBeenCalledWith(
      makeTestOrgContext(USER),
      "doc-old",
    );
    expect(deleteObject).toHaveBeenCalledWith("durability-evidence/old.pdf");
  });
});
