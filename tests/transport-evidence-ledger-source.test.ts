/**
 * Core-logic tests for `ensureTransportEvidenceLedgerSourceFromContext` — the
 * generate → store → mirror → supersede flow that rides into a removal's
 * `source_ids` on submit. All boundaries (renderer, storage, documents
 * data-access, mirror) are faked; the real content-hash + reuse/supersede
 * branching runs. Covers: fresh create, identical-content reuse (no-op),
 * changed-content supersede (retire prior), legs-removed, and no-mapping skip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportLeg } from "@/db/schema";
import type { RemovalSubmissionContext } from "@/fn/certification/certify-context-core";

const USER = "user-1";
const REMOVAL = "removal-1";
const BATCH = "batch-1";
const FACILITY = "facility-1";

const ledgerDbMocks = vi.hoisted(() => {
  const tx = { execute: vi.fn(async () => ({ rows: [] })) };
  return {
    tx,
    transaction: vi.fn(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
});

// ── Boundary mocks ───────────────────────────────────────────────────────────
vi.mock("@/db", () => ({
  db: {
    transaction: ledgerDbMocks.transaction,
  },
}));
vi.mock("@/lib/certification/submission-lock", () => ({
  acquireCertificationArtifactLocksSorted: vi.fn(async () => {}),
}));
vi.mock("@/fn/certification/certify-context-core", () => ({
  loadRemovalSubmissionContext: vi.fn(),
}));
vi.mock("@/lib/certification/evidence-ledger/pdf", () => ({
  renderEvidenceLedgerPdf: vi.fn(async () => Buffer.from("%PDF-fake")),
}));
vi.mock("@/data-access/facilities", () => ({
  getFacilityById: vi.fn(async () => ({ id: FACILITY, name: "Dark Earth Hub" })),
}));
vi.mock("@/data-access/documents", () => ({
  listDocumentsByKindForRemoval: vi.fn(async () => []),
  insertDocument: vi.fn(async (_userId: string, row: Record<string, unknown>) => ({
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
    externalDocumentId: "src_new",
    isPublic: false,
    recovered: false,
  })),
}));

const putObject = vi.fn(
  async (key: string, body: Buffer, contentType: string) => {
    void key;
    void body;
    void contentType;
  },
);
const deleteObject = vi.fn(async (key: string) => {
  void key;
});
vi.mock("@/lib/storage", () => ({
  getStorageProvider: vi.fn(() => ({
    name: "local-fs",
    bucket: "local-fs",
    putObject,
    deleteObject,
  })),
}));

import {
  listDocumentsByKindForRemoval,
  insertDocument,
  deleteDocumentRow,
} from "@/data-access/documents";
import {
  getDocumentUploadByDocument,
  deleteDocumentUploadByDocument,
} from "@/data-access/certifier-document-uploads";
import { renderEvidenceLedgerPdf } from "@/lib/certification/evidence-ledger/pdf";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { mirrorDocumentToSourceForUser } from "@/fn/certification/sources";
import { ensureTransportEvidenceLedgerSourceFromContext } from "@/fn/certification/evidence-ledger";

// ── Fixtures ─────────────────────────────────────────────────────────────────
function leg(distanceKm: number, loadMassKg: number): TransportLeg {
  return {
    id: "leg-x",
    entityType: "feedstock",
    entityId: "ent-x",
    originName: "Origin Co.",
    originGpsLatitude: -3.286,
    originGpsLongitude: 37.157,
    destinationName: "Facility",
    destinationGpsLatitude: -3.348,
    destinationGpsLongitude: 37.34,
    distanceKm,
    distanceSource: "map_estimate",
    transportMethodType: "road",
    vehicleType: "Heavy truck",
    modelYear: null,
    loadMassKg,
    calculationMethodType: "distance_based",
    isDerived: true,
  } as unknown as TransportLeg;
}

function ctx(overrides?: {
  mapping?: unknown;
  legs?: { feedstock: TransportLeg[]; biochar: TransportLeg[]; sample: TransportLeg[] };
}): RemovalSubmissionContext {
  return {
    facilityId: FACILITY,
    removalId: REMOVAL,
    mapping:
      overrides?.mapping === undefined
        ? { externalProjectId: "prj_TEST" }
        : overrides.mapping,
    memberBatches: [{ id: BATCH, code: "CB-26-001" }],
    transportLegs: overrides?.legs ?? {
      feedstock: [leg(34, 4500)],
      biochar: [],
      sample: [],
    },
  } as unknown as RemovalSubmissionContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDocumentsByKindForRemoval).mockResolvedValue([]);
  vi.mocked(getDocumentUploadByDocument).mockResolvedValue(null);
  vi.mocked(insertDocument).mockImplementation(
    async (_userId: string, row: Record<string, unknown>) =>
      ({ ...row, id: "doc-new" }) as never,
  );
  vi.mocked(mirrorDocumentToSourceForUser).mockResolvedValue({
    externalDocumentId: "src_new",
    isPublic: false,
    recovered: false,
  });
});

describe("ensureTransportEvidenceLedgerSourceFromContext", () => {
  it("creates a fresh ledger document, stores it, and mirrors it", async () => {
    const result = await ensureTransportEvidenceLedgerSourceFromContext(
      USER,
      REMOVAL,
      ctx(),
    );

    expect(renderEvidenceLedgerPdf).toHaveBeenCalledOnce();
    expect(putObject).toHaveBeenCalledOnce();
    const [key, body, contentType] = putObject.mock.calls[0];
    expect(key).toMatch(
      new RegExp(`^transport-evidence/${FACILITY}/${REMOVAL}/[a-f0-9]{64}\\.pdf$`),
    );
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(contentType).toBe("application/pdf");

    const insertedRow = vi.mocked(insertDocument).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(insertedRow.entityType).toBe("credit_batch");
    expect(insertedRow.entityId).toBe(BATCH);
    expect(insertedRow.documentType).toBe("pdf");
    expect(insertedRow.storageProvider).toBe("local-fs");
    expect(insertedRow.storageBucket).toBe("local-fs");
    expect(insertedRow.visibility).toBe("private");
    expect(insertedRow.uploadStatus).toBe("uploaded");
    expect(insertedRow.mimeType).toBe("application/pdf");
    const meta = insertedRow.metadata as Record<string, unknown>;
    expect(meta.kind).toBe("transport_evidence_ledger");
    expect(meta.removalId).toBe(REMOVAL);
    expect(typeof meta.contentHash).toBe("string");

    expect(mirrorDocumentToSourceForUser).toHaveBeenCalledWith(USER, {
      removalId: REMOVAL,
      documentId: "doc-new",
      isPublic: false,
    });

    expect(result).toMatchObject({
      status: "created",
      documentId: "doc-new",
      externalSourceId: "src_new",
    });
    expect(ledgerDbMocks.transaction).toHaveBeenCalledOnce();
    expect(acquireCertificationArtifactLocksSorted).toHaveBeenCalledWith(
      ledgerDbMocks.tx,
      [
        {
          provider: "isometric",
          localEntityType: "removal",
          localEntityId: REMOVAL,
        },
      ],
    );
    expect(deleteDocumentRow).not.toHaveBeenCalled();
  });

  it("reuses an identical-content ledger that is already mirrored (no-op)", async () => {
    // Phase 1: a fresh create captures the real content hash for these legs.
    const created = await ensureTransportEvidenceLedgerSourceFromContext(
      USER,
      REMOVAL,
      ctx(),
    );
    expect(created.status).toBe("created");
    const hash = (created as { contentHash: string }).contentHash;

    // Phase 2: a prior doc with that exact hash exists and is mirrored.
    vi.clearAllMocks();
    vi.mocked(listDocumentsByKindForRemoval).mockResolvedValue([
      {
        id: "doc-prior",
        storageKey: "transport-evidence/old.pdf",
        metadata: { kind: "transport_evidence_ledger", removalId: REMOVAL, contentHash: hash },
      } as never,
    ]);
    vi.mocked(getDocumentUploadByDocument).mockResolvedValue({
      externalDocumentId: "src_prior",
    } as never);

    const result = await ensureTransportEvidenceLedgerSourceFromContext(
      USER,
      REMOVAL,
      ctx(),
    );

    expect(result).toMatchObject({
      status: "reused",
      documentId: "doc-prior",
      externalSourceId: "src_prior",
    });
    expect(renderEvidenceLedgerPdf).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(insertDocument).not.toHaveBeenCalled();
    expect(mirrorDocumentToSourceForUser).not.toHaveBeenCalled();
    // Only one prior, and it's the kept one → nothing retired.
    expect(deleteDocumentRow).not.toHaveBeenCalled();
  });

  it("supersedes a changed-content prior: new doc + retire the stale one", async () => {
    vi.mocked(listDocumentsByKindForRemoval).mockResolvedValue([
      {
        id: "doc-old",
        storageKey: "transport-evidence/old-hash.pdf",
        metadata: { kind: "transport_evidence_ledger", removalId: REMOVAL, contentHash: "stale" },
      } as never,
    ]);

    const result = await ensureTransportEvidenceLedgerSourceFromContext(
      USER,
      REMOVAL,
      ctx(),
    );

    expect(result).toMatchObject({ status: "created", documentId: "doc-new" });
    expect(renderEvidenceLedgerPdf).toHaveBeenCalledOnce();
    expect(insertDocument).toHaveBeenCalledOnce();
    // Retire order: mapping first (FK is RESTRICT), then row, then bytes.
    expect(deleteDocumentUploadByDocument).toHaveBeenCalledWith(
      USER,
      "isometric",
      "doc-old",
    );
    expect(deleteDocumentRow).toHaveBeenCalledWith(USER, "doc-old");
    expect(deleteObject).toHaveBeenCalledWith("transport-evidence/old-hash.pdf");
  });

  it("skips and retires priors when all legs are gone", async () => {
    vi.mocked(listDocumentsByKindForRemoval).mockResolvedValue([
      {
        id: "doc-old",
        storageKey: "transport-evidence/old.pdf",
        metadata: { kind: "transport_evidence_ledger", removalId: REMOVAL, contentHash: "stale" },
      } as never,
    ]);

    const result = await ensureTransportEvidenceLedgerSourceFromContext(
      USER,
      REMOVAL,
      ctx({ legs: { feedstock: [], biochar: [], sample: [] } }),
    );

    expect(result).toEqual({ status: "skipped", reason: "no-legs" });
    expect(renderEvidenceLedgerPdf).not.toHaveBeenCalled();
    expect(insertDocument).not.toHaveBeenCalled();
    expect(mirrorDocumentToSourceForUser).not.toHaveBeenCalled();
    expect(deleteDocumentUploadByDocument).toHaveBeenCalledWith(
      USER,
      "isometric",
      "doc-old",
    );
    expect(deleteDocumentRow).toHaveBeenCalledWith(USER, "doc-old");
  });

  it("skips entirely when the facility has no Isometric project", async () => {
    const result = await ensureTransportEvidenceLedgerSourceFromContext(
      USER,
      REMOVAL,
      ctx({ mapping: null }),
    );

    expect(result).toEqual({ status: "skipped", reason: "no-mapping" });
    expect(ledgerDbMocks.transaction).not.toHaveBeenCalled();
    expect(listDocumentsByKindForRemoval).not.toHaveBeenCalled();
    expect(renderEvidenceLedgerPdf).not.toHaveBeenCalled();
    expect(mirrorDocumentToSourceForUser).not.toHaveBeenCalled();
  });
});
