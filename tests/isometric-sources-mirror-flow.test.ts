/**
 * Phase 3.5 — mirror-flow recovery integration tests.
 *
 * Covers the two approval-gate paths from the orphan-recovery contract:
 *
 *   1. GET found  →  signed_upload_url 200  →  PUT  →  insert
 *      (a previous attempt POSTed `/sources` but crashed before/inside the
 *      PUT — the next mirror call finds the existing remote Source, gets a
 *      fresh upload URL, re-uploads, and inserts the local mapping.)
 *
 *   2. GET found  →  signed_upload_url 409  →  insert
 *      (a previous attempt completed the PUT but crashed before persisting
 *      the local row — the next mirror call finds the existing remote
 *      Source, learns it's already uploaded, and just inserts the local
 *      mapping.)
 *
 * The sibling unit suite `isometric-sources.test.ts` covers the deterministic
 * supplier_ref builder + the `source_ids` plumbing + the hash supersede
 * contract. This file is the integration layer: the server action runs for
 * real with data-access / storage / isometric-client boundaries faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/lib/auth/server", () => ({
  requireOrgRole: vi.fn(),
  requireOrgContext: vi.fn(async () => ({
    userId: USER_ID,
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  })),
}));
vi.mock("@/data-access/certification");
vi.mock("@/data-access/certification-submissions");
vi.mock("@/data-access/certifier-removals");
vi.mock("@/data-access/credit-batch-accounting");
vi.mock("@/data-access/credit-batch-samples", () => ({
  getSamplesByCreditBatchIds: vi.fn(),
}));
vi.mock("@/data-access/documents");
vi.mock("@/data-access/certifier-document-uploads");
vi.mock("@/data-access/certifier-organization-settings");
vi.mock("@/db", () => {
  // Mirror flow opens `db.transaction(async (tx) => ...)` — the callback
  // body runs straight through with `tx` set to a stub. Real DB writes
  // happen via mocked data-access fns, so the tx is never actually used.
  const fakeTx = {
    execute: vi.fn(async () => ({ rows: [] })),
  };
  const fakeDb = {
    transaction: vi.fn(
      async (fn: (tx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx),
    ),
  };
  return { db: fakeDb };
});
vi.mock("@/lib/storage", () => {
  return {
    getStorageProvider: vi.fn(() => ({
      headObject: vi.fn(async () => ({
        size: DOCUMENT_FIXTURE.fileSizeBytes,
        contentType: DOCUMENT_FIXTURE.mimeType,
        etag: "etag-1",
      })),
      getObject: vi.fn(async () => ({
        bytes: Buffer.from("file-bytes"),
        contentType: DOCUMENT_FIXTURE.mimeType,
      })),
    })),
  };
});
vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => ({} as import("@/lib/isometric").IsometricClient)),
    findSourceBySupplierRef: vi.fn(),
    requestSignedUploadUrl: vi.fn(),
    createSource: vi.fn(),
  };
});

// Stable fixtures referenced by mocks above. Declared *after* the mocks
// because vi.mock factories are hoisted but reference the constants
// lazily via closure.
// Use valid v4 UUIDs (version nibble = 4, variant nibble in 8-b) so the
// Zod `z.string().uuid()` parse on input schemas passes.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const FACILITY_ID = "33333333-3333-4333-8333-333333333333";
const APPLICATION_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";
const CREDIT_BATCH_ID = "66666666-6666-4666-8666-666666666666";
const PRODUCTION_RUN_ID = "77777777-7777-4777-8777-777777777777";
const SAMPLE_ID = "88888888-8888-4888-8888-888888888888";
const PROJECT_ID = "prj_TEST";
const EXISTING_SOURCE_ID = "src_recovered";

const DOCUMENT_FIXTURE = {
  id: DOCUMENT_ID,
  fileName: "application-inventory.pdf",
  documentType: "pdf" as const,
  mimeType: "application/pdf",
  fileSizeBytes: 12345,
  storageKey: "documents/application-inventory.pdf",
  capturedAt: new Date("2026-01-05T00:00:00Z"),
  createdAt: new Date("2026-01-05T00:00:00Z"),
  checksumSha256: null,
  uploadStatus: "uploaded" as const,
  fileUrl: null,
  metadata: { logbookEvidenceType: "inventory" },
};

import * as removalsDA from "@/data-access/certifier-removals";
import * as ledgerDA from "@/data-access/certification";
import * as submissionsDA from "@/data-access/certification-submissions";
import * as creditBatchAccountingDA from "@/data-access/credit-batch-accounting";
import * as creditBatchSamplesDA from "@/data-access/credit-batch-samples";
import * as documentsDA from "@/data-access/documents";
import * as uploadsDA from "@/data-access/certifier-document-uploads";
import * as organizationSettingsDA from "@/data-access/certifier-organization-settings";
import * as isometric from "@/lib/isometric";
import {
  loadCandidateDocumentsForRemovalForUser,
  mirrorCandidateSourcesForSubmission,
  mirrorDocumentToSource,
} from "@/fn/certification/sources";
import { buildSourceSupplierRef } from "@/lib/isometric/utils/source-ref";

const SUPPLIER_REF = buildSourceSupplierRef(DOCUMENT_ID);

beforeEach(() => {
  vi.clearAllMocks();

  // ── Lineage + mapping (loadCandidateDocumentsForRemovalInternal) ────
  vi.mocked(removalsDA.getCertifierRemovalById).mockResolvedValue({
    id: REMOVAL_ID,
    facilityId: FACILITY_ID,
  } as never);
  vi.mocked(ledgerDA.getCertifierProjectByFacility).mockResolvedValue({
    facilityId: FACILITY_ID,
    externalProjectId: PROJECT_ID,
    provider: "isometric",
  } as never);
  vi.mocked(
    submissionsDA.getLatestSubmissionWithExecutor,
  ).mockResolvedValue(null);
  vi.mocked(removalsDA.getCreditBatchesByRemovalId).mockResolvedValue([
    {
      id: CREDIT_BATCH_ID,
      code: "CB-001",
    },
  ] as never);
  vi.mocked(creditBatchAccountingDA.loadCreditBatchRollups).mockResolvedValue({
    [CREDIT_BATCH_ID]: {
      batch: {
        id: CREDIT_BATCH_ID,
        code: "CB-001",
      },
      lineageFacts: {
        applications: [
          {
            id: APPLICATION_ID,
            code: "APP-001",
            delivery: { id: DELIVERY_ID, code: "DEL-001" },
          },
        ],
        runs: [
          {
            id: PRODUCTION_RUN_ID,
            feedstocks: [],
          },
        ],
      },
    },
  } as never);
  vi.mocked(creditBatchSamplesDA.getSamplesByCreditBatchIds).mockResolvedValue(
    [],
  );
  vi.mocked(documentsDA.listDocumentsForEntity).mockImplementation(
    async (_userId, entityType, entityId) => {
      // The document lives on the application — every other entity in the
      // chain has no documents in these tests.
      if (entityType === "application" && entityId === APPLICATION_ID) {
        return [DOCUMENT_FIXTURE] as never;
      }
      return [] as never;
    },
  );
  vi.mocked(uploadsDA.listDocumentUploadsForDocuments).mockResolvedValue([]);
  vi.mocked(
    organizationSettingsDA.getRegistrySourceVisibility,
  ).mockResolvedValue("private");
  vi.mocked(documentsDA.getDocumentById).mockResolvedValue(
    DOCUMENT_FIXTURE as never,
  );

  // ── Local mapping (idempotency short-circuit) — none yet ─────────────
  vi.mocked(uploadsDA.getDocumentUploadByDocument).mockResolvedValue(null);

  // ── insert returns `inserted: true` (we won the race) ────────────────
  vi.mocked(uploadsDA.insertOrGetDocumentUpload).mockImplementation(
    async (_userId, input) =>
      ({
        row: {
          id: "upload-row-1",
          provider: input.provider,
          documentId: input.documentId,
          externalDocumentId: input.externalDocumentId,
          metadata: input.metadata,
          createdAt: new Date(),
        },
        inserted: true,
      }) as never,
  );

  // ── Ledger sync-event recorder is best-effort ────────────────────────
  vi.mocked(ledgerDA.appendSyncEvent).mockResolvedValue(undefined as never);
});

describe("mirrorDocumentToSource — orphan recovery", () => {
  it("excludes unconfirmed documents and their old mappings from candidate readback", async () => {
    vi.mocked(documentsDA.listDocumentsForEntity).mockImplementation(
      async (_userId, entityType, entityId) =>
        entityType === "application" && entityId === APPLICATION_ID
          ? ([
              {
                ...DOCUMENT_FIXTURE,
                uploadStatus: "failed",
                fileUrl: "https://example.test/failed-document.pdf",
              },
            ] as never)
          : ([] as never),
    );
    vi.mocked(uploadsDA.listDocumentUploadsForDocuments).mockResolvedValue([
      {
        documentId: DOCUMENT_ID,
        externalDocumentId: EXISTING_SOURCE_ID,
        metadata: { isPublic: false },
      },
    ] as never);

    const result = await loadCandidateDocumentsForRemovalForUser(
      makeTestOrgContext(USER_ID),
      REMOVAL_ID,
    );

    expect(result.candidates).toEqual([]);
    expect(result.mirroredExternalIds).toEqual([]);
  });

  it("mirrors a pending candidate when submission prepares its sources", async () => {
    vi.mocked(isometric.findSourceBySupplierRef).mockResolvedValue({
      id: EXISTING_SOURCE_ID,
      is_public: false,
    } as never);
    vi.mocked(isometric.requestSignedUploadUrl).mockResolvedValue({
      kind: "already_uploaded",
    });

    await mirrorCandidateSourcesForSubmission(
      makeTestOrgContext(USER_ID),
      {
        removalId: REMOVAL_ID,
        candidateDocumentIds: [DOCUMENT_ID],
      },
    );

    expect(uploadsDA.insertOrGetDocumentUpload).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        externalDocumentId: EXISTING_SOURCE_ID,
      }),
      expect.anything(),
    );
  });

  it("authorizes a Sample lab report discovered for the member batch", async () => {
    vi.mocked(creditBatchSamplesDA.getSamplesByCreditBatchIds).mockResolvedValue(
      [
        {
          id: SAMPLE_ID,
          creditBatchId: CREDIT_BATCH_ID,
          sampleCode: "LAB-001",
        },
      ],
    );
    vi.mocked(documentsDA.listDocumentsForEntity).mockImplementation(
      async (_userId, entityType, entityId) =>
        entityType === "sample" && entityId === SAMPLE_ID
          ? [
              {
                ...DOCUMENT_FIXTURE,
                fileName: "sample-lab-report.pdf",
                documentType: "lab_report",
              },
            ] as never
          : [] as never,
    );
    vi.mocked(isometric.findSourceBySupplierRef).mockResolvedValue({
      id: EXISTING_SOURCE_ID,
      is_public: false,
    } as never);
    vi.mocked(isometric.requestSignedUploadUrl).mockResolvedValue({
      kind: "already_uploaded",
    });

    await mirrorCandidateSourcesForSubmission(
      makeTestOrgContext(USER_ID),
      {
        removalId: REMOVAL_ID,
        candidateDocumentIds: [DOCUMENT_ID],
      },
    );

    expect(documentsDA.listDocumentsForEntity).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      "sample",
      SAMPLE_ID,
    );
    expect(uploadsDA.insertOrGetDocumentUpload).toHaveBeenCalledWith(
      makeTestOrgContext(USER_ID),
      expect.objectContaining({ documentId: DOCUMENT_ID }),
      expect.anything(),
    );
    const candidates = await loadCandidateDocumentsForRemovalForUser(
      makeTestOrgContext(USER_ID),
      REMOVAL_ID,
    );
    expect(candidates.candidates[0]?.lineageEntity.entityLabel).toBe(
      "Sample LAB-001",
    );
  });

  it.each(["submitted", "accepted", "superseded"] as const)(
    "rejects public mirroring when the latest Removal submission is %s",
    async (status) => {
      vi.mocked(
        submissionsDA.getLatestSubmissionWithExecutor,
      ).mockResolvedValue({
        status,
        lockedAt: null,
      } as never);

      const result = await mirrorDocumentToSource({
        removalId: REMOVAL_ID,
        documentId: DOCUMENT_ID,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatch(/registry value sources are read-only/i);
      expect(isometric.getIsometricClientForOrg).not.toHaveBeenCalled();
      expect(isometric.findSourceBySupplierRef).not.toHaveBeenCalled();
      expect(isometric.createSource).not.toHaveBeenCalled();
      expect(uploadsDA.insertOrGetDocumentUpload).not.toHaveBeenCalled();
    },
  );

  it("rejects public mirroring while Removal submission is in flight", async () => {
    vi.mocked(
      submissionsDA.getLatestSubmissionWithExecutor,
    ).mockResolvedValue({
      status: "draft",
      lockedAt: new Date(),
    } as never);

    const result = await mirrorDocumentToSource({
      removalId: REMOVAL_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/submission is in progress/i);
    expect(isometric.getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(isometric.createSource).not.toHaveBeenCalled();
  });

  it("GET found → signed_upload_url 200 → PUT → insert", async () => {
    // Remote Source already exists from a previous attempt.
    vi.mocked(isometric.findSourceBySupplierRef).mockResolvedValue({
      id: EXISTING_SOURCE_ID,
      is_public: false,
    } as never);
    // signed_upload_url returns a fresh URL — the PUT did not complete on
    // the previous attempt, so we re-upload.
    vi.mocked(isometric.requestSignedUploadUrl).mockResolvedValue({
      kind: "url",
      uploadUrl: "https://noma-test.s3.amazonaws.com/signed-upload",
    });
    // Global fetch handles only the Isometric PUT; storage reads use the
    // provider seam.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("signed-upload") && init?.method === "PUT") {
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

    try {
      const result = await mirrorDocumentToSource({
        removalId: REMOVAL_ID,
        documentId: DOCUMENT_ID,
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      expect(result.data).toEqual({
        externalDocumentId: EXISTING_SOURCE_ID,
        isPublic: false,
        recovered: true,
      });
      // We never POSTed a fresh `/sources` — reconciliation reused the remote.
      expect(isometric.createSource).not.toHaveBeenCalled();
      // We DID upload the bytes (200 path).
      const putCalls = fetchSpy.mock.calls.filter(
        ([, init]) => init?.method === "PUT",
      );
      expect(putCalls).toHaveLength(1);
      // We persisted the local mapping with the remote source id.
      expect(uploadsDA.insertOrGetDocumentUpload).toHaveBeenCalledWith(
        makeTestOrgContext(USER_ID),
        expect.objectContaining({
          externalDocumentId: EXISTING_SOURCE_ID,
          metadata: expect.objectContaining({
            supplierRefId: SUPPLIER_REF,
            isPublic: false,
          }),
        }),
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("GET found → signed_upload_url 409 → insert (no PUT)", async () => {
    // Remote Source already exists AND the previous attempt completed the
    // PUT — only the local insert was missed.
    vi.mocked(isometric.findSourceBySupplierRef).mockResolvedValue({
      id: EXISTING_SOURCE_ID,
      is_public: false,
    } as never);
    vi.mocked(isometric.requestSignedUploadUrl).mockResolvedValue({
      kind: "already_uploaded",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("unexpected global fetch call");
      });

    try {
      const result = await mirrorDocumentToSource({
        removalId: REMOVAL_ID,
        documentId: DOCUMENT_ID,
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      expect(result.data).toEqual({
        externalDocumentId: EXISTING_SOURCE_ID,
        isPublic: false,
        recovered: true,
      });
      expect(isometric.createSource).not.toHaveBeenCalled();
      // No network I/O at all — the registry already has the bytes, so the
      // already_uploaded path skips both the storage GET and the registry PUT.
      expect(fetchSpy).not.toHaveBeenCalled();
      // Local mapping persisted against the existing remote source.
      expect(uploadsDA.insertOrGetDocumentUpload).toHaveBeenCalledWith(
        makeTestOrgContext(USER_ID),
        expect.objectContaining({
          externalDocumentId: EXISTING_SOURCE_ID,
        }),
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reconciled metadata mirrors remote is_public (not caller's request)", async () => {
    // The remote Source was created PUBLIC by a prior attempt. The persisted
    // organization policy is private now, but the locally-persisted row must
    // reflect the existing remote Source (Isometric is authoritative).
    vi.mocked(isometric.findSourceBySupplierRef).mockResolvedValue({
      id: EXISTING_SOURCE_ID,
      is_public: true,
    } as never);
    vi.mocked(isometric.requestSignedUploadUrl).mockResolvedValue({
      kind: "already_uploaded",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("unexpected global fetch call");
      });

    try {
      const result = await mirrorDocumentToSource({
        removalId: REMOVAL_ID,
        documentId: DOCUMENT_ID,
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      // Result echoes the remote, not the request.
      expect(result.data.isPublic).toBe(true);
      expect(uploadsDA.insertOrGetDocumentUpload).toHaveBeenCalledWith(
        makeTestOrgContext(USER_ID),
        expect.objectContaining({
          metadata: expect.objectContaining({ isPublic: true }),
        }),
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("derives fresh Source visibility from the persisted organization policy", async () => {
    vi.mocked(
      organizationSettingsDA.getRegistrySourceVisibility,
    ).mockResolvedValue("public");
    vi.mocked(isometric.findSourceBySupplierRef).mockResolvedValue(null);
    vi.mocked(isometric.createSource).mockResolvedValue({
      source: { id: "src_policy_public" },
      signed_upload_url:
        "https://noma-test.s3.amazonaws.com/policy-signed-upload",
    } as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("policy-signed-upload") && init?.method === "PUT") {
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

    try {
      // Unknown keys are stripped by the action schema. Even a legacy caller
      // attempting the removed per-document override cannot beat the policy.
      const result = await mirrorDocumentToSource({
        removalId: REMOVAL_ID,
        documentId: DOCUMENT_ID,
        isPublic: false,
      });

      expect(result).toMatchObject({
        success: true,
        data: { isPublic: true, recovered: false },
      });
      expect(
        organizationSettingsDA.getRegistrySourceVisibility,
      ).toHaveBeenCalledWith(
        makeTestOrgContext(USER_ID),
        "isometric",
      );
      expect(isometric.createSource).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          is_public: true,
          description:
            "Noma role: Inventory. Lineage: Application APP-001.",
        }),
      );
      expect(uploadsDA.insertOrGetDocumentUpload).toHaveBeenCalledWith(
        makeTestOrgContext(USER_ID),
        expect.objectContaining({
          metadata: expect.objectContaining({ isPublic: true }),
        }),
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects mutations for a document outside the removal's lineage", async () => {
    // The document scan returns NO documents under this removal's lineage
    // — but the caller has somehow learned a valid documentId. The mirror
    // must refuse rather than silently fetching + uploading.
    vi.mocked(documentsDA.listDocumentsForEntity).mockResolvedValue([] as never);

    const result = await mirrorDocumentToSource({
      removalId: REMOVAL_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe(
      "This document is not available for this Removal. Reload the panel and try again.",
    );
    expect(isometric.findSourceBySupplierRef).not.toHaveBeenCalled();
    expect(isometric.createSource).not.toHaveBeenCalled();
    expect(uploadsDA.insertOrGetDocumentUpload).not.toHaveBeenCalled();
  });

  it("fails closed when a confirmed candidate becomes unconfirmed before mirroring", async () => {
    vi.mocked(documentsDA.getDocumentById).mockResolvedValue({
      ...DOCUMENT_FIXTURE,
      uploadStatus: "failed",
    } as never);

    const result = await mirrorDocumentToSource({
      removalId: REMOVAL_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/upload has not been confirmed/i);
    expect(isometric.getIsometricClientForOrg).not.toHaveBeenCalled();
    expect(isometric.findSourceBySupplierRef).not.toHaveBeenCalled();
    expect(isometric.createSource).not.toHaveBeenCalled();
    expect(uploadsDA.insertOrGetDocumentUpload).not.toHaveBeenCalled();
  });
});
