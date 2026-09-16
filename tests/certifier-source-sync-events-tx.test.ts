/**
 * Issue #772 / F19 — Source audit events must not be written while the mirror
 * transaction is held.
 *
 * `appendSyncEvent` always inserts through the root pooled `db`. The mirror
 * business transaction owns a pooled connection for its whole body, so an
 * audit insert issued from inside it asks for a *second* connection. At the
 * production pool size (`DEFAULT_DB_POOL_MAX` is 1) that request can only time
 * out, and `appendSyncEventBestEffort` swallows the timeout — the audit row
 * disappears and the mirror stalls for the acquisition timeout first.
 *
 * This suite pins the fix against a real single-connection pool: the pool is
 * forced to `max: 1` through the env mock that `src/db/index.ts` reads, so an
 * audit write attempted inside the transaction cannot succeed by accident.
 * Everything that talks to Isometric or object storage is faked; the database
 * is real, because the pool behaviour *is* the thing under test.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq, inArray } from "drizzle-orm";

const TEST_TIMEOUT_MS = 20_000;
const EXTERNAL_PROJECT_ID = "prj_source_audit_tx";

// Read inside hoisted `vi.mock` factories, so they must be hoisted too.
const { POOL_CONNECTION_TIMEOUT_MS, DOCUMENT_BYTES, DOCUMENT_MIME_TYPE } =
  vi.hoisted(() => ({
    POOL_CONNECTION_TIMEOUT_MS: 1_000,
    DOCUMENT_BYTES: 4_096,
    DOCUMENT_MIME_TYPE: "application/pdf",
  }));

// A single pooled connection is the production default. The short acquisition
// timeout keeps a regression fast: the old code waited the full 10 s before
// swallowing the audit write.
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return {
    ...original,
    env: {
      ...original.env,
      DB_POOL_MAX: 1,
      DB_POOL_CONNECTION_TIMEOUT_MS: POOL_CONNECTION_TIMEOUT_MS,
    },
  };
});

vi.mock("@/lib/auth/server", () => ({
  requireOrgRole: vi.fn(),
  requireOrgContext: vi.fn(),
}));

// Passthrough spy on the one insert this issue is about. It records how deep
// inside `db.transaction` it ran, which is the ordering assertion, and can be
// made to fail to prove the mirror survives a broken audit trail.
const auditSpy = vi.hoisted(() => ({
  depths: [] as number[],
  failWith: null as Error | null,
}));

vi.mock("@/data-access/certifier-sync-events", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/data-access/certifier-sync-events")>();
  return {
    ...actual,
    appendSyncEvent: vi.fn(async (...args: Parameters<typeof actual.appendSyncEvent>) => {
      auditSpy.depths.push(transactionDepth);
      if (auditSpy.failWith) throw auditSpy.failWith;
      return actual.appendSyncEvent(...args);
    }),
  };
});

vi.mock("@/data-access/certification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data-access/certification")>();
  return { ...actual, getCertifierProjectByFacility: vi.fn() };
});
vi.mock("@/data-access/certifier-removals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data-access/certifier-removals")>();
  return { ...actual, getCertifierRemovalById: vi.fn() };
});
vi.mock("@/data-access/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data-access/documents")>();
  return { ...actual, getDocumentById: vi.fn() };
});
vi.mock("@/data-access/certifier-organization-settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/data-access/certifier-organization-settings")>();
  return { ...actual, getRegistrySourceVisibility: vi.fn(async () => "private" as const) };
});
vi.mock("@/lib/storage", () => ({
  getStorageProvider: vi.fn(() => ({
    headObject: vi.fn(async () => ({
      size: DOCUMENT_BYTES,
      contentType: DOCUMENT_MIME_TYPE,
      etag: "etag-source-audit",
    })),
  })),
}));
vi.mock("@/lib/isometric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(
      async () => ({}) as import("@/lib/isometric").IsometricClient,
    ),
    findSourceBySupplierRef: vi.fn(async () => null),
    requestSignedUploadUrl: vi.fn(),
    createSource: vi.fn(),
  };
});

import { db } from "@/db";
import { organizations } from "@/db/schema/auth";
import {
  certifierDocumentUploads,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import * as certificationDA from "@/data-access/certification";
import * as removalsDA from "@/data-access/certifier-removals";
import * as documentsDA from "@/data-access/documents";
import * as isometric from "@/lib/isometric";
import { mirrorDocumentToSourceForUser } from "@/fn/certification/sources";
import type { OrgContext } from "@/lib/auth/server";

/**
 * Nesting level of the mirror's business transaction at the moment an audit
 * insert runs. A staged flush always sees 0; an inline write sees 1.
 */
let transactionDepth = 0;

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_src_audit_${RUN_ID}`;
const REMOVAL_ID = crypto.randomUUID();
const FACILITY_ID = crypto.randomUUID();
const APPLICATION_ID = crypto.randomUUID();

const orgCtx: OrgContext = {
  userId: `user_src_audit_${RUN_ID}`,
  organizationId: ORG_ID,
  orgRole: "owner",
  isPlatformAdmin: false,
};

const createdDocumentIds: string[] = [];

async function seedDocument(): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({
      organizationId: ORG_ID,
      entityType: "biochar_application",
      entityId: APPLICATION_ID,
      documentType: "pdf",
      storageProvider: "local-fs",
      storageBucket: "test-bucket",
      storageKey: `documents/${crypto.randomUUID()}.pdf`,
      fileName: "source-audit-tx.pdf",
      fileSizeBytes: DOCUMENT_BYTES,
      mimeType: DOCUMENT_MIME_TYPE,
      uploadStatus: "uploaded",
      capturedAt: new Date("2026-01-05T00:00:00Z"),
    })
    .returning();
  createdDocumentIds.push(row.id);
  vi.mocked(documentsDA.getDocumentById).mockResolvedValue(row);
  return row.id;
}

function mirror(documentId: string) {
  return mirrorDocumentToSourceForUser(
    orgCtx,
    { removalId: REMOVAL_ID, documentId },
    {
      // Skips the live candidate re-derivation and the lifecycle guard, both of
      // which are covered elsewhere and irrelevant to the pool contract.
      submissionCandidate: {
        documentId,
        binding: null,
        biocharApplicationId: APPLICATION_ID,
      },
    },
  );
}

function listSyncEvents(entityId: string) {
  return db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.organizationId, ORG_ID),
        eq(certifierSyncEvents.entityId, entityId),
      ),
    );
}

function listMappings(documentId: string) {
  return db
    .select()
    .from(certifierDocumentUploads)
    .where(eq(certifierDocumentUploads.documentId, documentId));
}

beforeAll(async () => {
  await db
    .insert(organizations)
    .values({
      id: ORG_ID,
      name: `Source audit tx ${RUN_ID}`,
      slug: `source-audit-tx-${RUN_ID}`,
    })
    .onConflictDoNothing();

  vi.mocked(removalsDA.getCertifierRemovalById).mockResolvedValue({
    id: REMOVAL_ID,
    facilityId: FACILITY_ID,
  } as Awaited<ReturnType<typeof removalsDA.getCertifierRemovalById>>);
  vi.mocked(certificationDA.getCertifierProjectByFacility).mockResolvedValue({
    facilityId: FACILITY_ID,
    provider: "isometric",
    externalProjectId: EXTERNAL_PROJECT_ID,
  } as Awaited<ReturnType<typeof certificationDA.getCertifierProjectByFacility>>);
});

// `restoreMocks` is on, so vitest strips every `vi.spyOn` before each test.
// The transaction probe therefore has to be reinstalled per test, not once.
beforeEach(() => {
  const openTransaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
    openTransaction(async (tx) => {
      transactionDepth += 1;
      try {
        return await callback(tx);
      } finally {
        transactionDepth -= 1;
      }
    }, config),
  );
});

afterEach(() => {
  auditSpy.depths.length = 0;
  auditSpy.failWith = null;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db
    .delete(certifierSyncEvents)
    .where(eq(certifierSyncEvents.organizationId, ORG_ID));
  if (createdDocumentIds.length > 0) {
    await db
      .delete(certifierDocumentUploads)
      .where(inArray(certifierDocumentUploads.documentId, createdDocumentIds));
    await db.delete(documents).where(inArray(documents.id, createdDocumentIds));
  }
  await db.delete(organizations).where(eq(organizations.id, ORG_ID));
});

describe("Source mirror audit events with a single pooled connection", () => {
  it(
    "writes the success event after the transaction commits",
    async () => {
      const documentId = await seedDocument();
      const externalId = `src_ok_${RUN_ID}`;
      vi.mocked(isometric.createSource).mockResolvedValue({
        source: { id: externalId },
        signed_upload_url: null,
      } as unknown as Awaited<ReturnType<typeof isometric.createSource>>);

      const result = await mirror(documentId);

      expect(result.externalDocumentId).toBe(externalId);
      // The whole point: the insert ran outside the held transaction.
      expect(auditSpy.depths).toEqual([0]);
      const events = await listSyncEvents(documentId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entityType: "document",
        operation: "source:create",
        status: "succeeded",
      });
      const mappings = await listMappings(documentId);
      expect(mappings).toHaveLength(1);
      expect(mappings[0].externalDocumentId).toBe(externalId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps the mirror mapping when the audit insert itself fails",
    async () => {
      const documentId = await seedDocument();
      const externalId = `src_audit_down_${RUN_ID}`;
      vi.mocked(isometric.createSource).mockResolvedValue({
        source: { id: externalId },
        signed_upload_url: null,
      } as unknown as Awaited<ReturnType<typeof isometric.createSource>>);
      auditSpy.failWith = new Error("certifier_sync_events insert unavailable");

      const result = await mirror(documentId);

      expect(result.externalDocumentId).toBe(externalId);
      expect(auditSpy.depths).toEqual([0]);
      expect(await listSyncEvents(documentId)).toHaveLength(0);
      const mappings = await listMappings(documentId);
      expect(mappings).toHaveLength(1);
      expect(mappings[0].externalDocumentId).toBe(externalId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "records both failure diagnostics after the transaction rolls back",
    async () => {
      const documentId = await seedDocument();
      const failure = new Error("Isometric /sources returned 503");
      vi.mocked(isometric.createSource).mockRejectedValue(failure);

      await expect(mirror(documentId)).rejects.toBe(failure);

      // One diagnostic per audit identity: the document and the Removal.
      expect(auditSpy.depths).toEqual([0, 0]);
      const documentEvents = await listSyncEvents(documentId);
      expect(documentEvents).toHaveLength(1);
      expect(documentEvents[0]).toMatchObject({
        entityType: "document",
        operation: "source:create",
        status: "failed",
        errorMessage: failure.message,
      });
      const removalEvents = await listSyncEvents(REMOVAL_ID);
      expect(removalEvents).toHaveLength(1);
      expect(removalEvents[0]).toMatchObject({
        entityType: "removal",
        operation: "source:create",
        status: "failed",
        errorMessage: failure.message,
      });
      expect(removalEvents[0].requestPayload).toMatchObject({ documentId });
      // Rollback means no mapping was left behind.
      expect(await listMappings(documentId)).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});
