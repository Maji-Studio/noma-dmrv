import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Boundary tests for the GHG Statement create pipeline against the fake
 * registry. The orphan-reconciliation boundary cases live in the focused
 * `registry-boundary-ghg-statement-orphan-reconciliation.test.ts` sibling;
 * Removal boundary cases live in `registry-boundary-removal.test.ts`.
 *
 * End-to-end across the recovery seams: the REAL `claimSubmissionDraft`
 * (DB-backed), REAL statement/ledger/sync-event writes, REAL
 * `performRegistryCreate`, and the REAL `findDraftGhgStatementsByPeriod`
 * wrapper — with only the Isometric client faked
 * (`tests/fixtures/fake-registry.ts`) and the auth session mocked (the
 * action runs through `withAction`).
 *
 * A GHG Statement has no supplier reference, so its orphan-reconciliation
 * key is `(project_id, end_on)` — and a period can legitimately hold several
 * DRAFT statements server-side, which is exactly the ambiguity the
 * three-way lookup's "multiple" arm rejects on.
 *
 * Requires a real Postgres (`.env.test`), like
 * tests/certification-submissions.test.ts.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Module mocks — only the registry transport and the auth session.
// ---------------------------------------------------------------------------

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});
vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    getUser: vi.fn(),
    // withAction resolves the org context; requireOrgRole keeps its real
    // owner⊃admin⊃member logic so the admin gate stays exercised.
    requireOrgContext: vi.fn(),
    requireOrgRole: actual.requireOrgRole,
  };
});

import { db, withDedicatedLockConnection } from "@/db";
import { claimSubmissionDraft } from "@/data-access/certification-submissions";
import { getOrCreateGhgStatementDraft } from "@/data-access/certifier-ghg-statements";
import { acquireFacilityDurabilityLock } from "@/data-access/facility-durability-lock";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import {
  createGhgStatementDraft,
  loadGhgStatementsForFacility,
} from "@/fn/certification/ghg-statements";
import { reconcileGhgStatementsFromRegistry } from "@/fn/certification/ghg-statement-sync";
import * as authServer from "@/lib/auth/server";
import { addDaysIso } from "@/lib/date-utils";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { payloadHash } from "@/lib/isometric";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const REPORTING_PERIOD_END = "2026-03-31";
// Inside the reporting window (first statement → unbounded start, so any
// completion on or before REPORTING_PERIOD_END is in-window).
const IN_WINDOW_COMPLETED_ON = "2026-03-15";
const STALE_LOCK_OFFSET_MS = LOCK_TTL_MS + 60_000;

const createdFacilityIds: string[] = [];

afterAll(async () => {
  if (createdFacilityIds.length === 0) return;
  // The seeded open removals (and their ledger rows) go first — they FK both
  // the facility and, once reconciled, the statement.
  const removals = await db
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(inArray(certifierRemovals.facilityId, createdFacilityIds));
  const removalIds = removals.map((removal) => removal.id);
  if (removalIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, removalIds));
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, removalIds));
  }
  const statements = await db
    .select({ id: certifierGhgStatements.id })
    .from(certifierGhgStatements)
    .where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
  const statementIds = statements.map((statement) => statement.id);
  if (statementIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, statementIds));
    await db
      .delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, statementIds));
    await db
      .delete(certifierGhgStatements)
      .where(inArray(certifierGhgStatements.id, statementIds));
  }
  await db
    .delete(certifierProjects)
    .where(inArray(certifierProjects.facilityId, createdFacilityIds));
  await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
});

// ---------------------------------------------------------------------------
// Fixture — a facility linked to a certifier project, plus a per-fixture
// user so the submit rate limit (5/min per user per action) never couples
// test cases.
// ---------------------------------------------------------------------------

interface Fixture {
  facilityId: string;
  externalProjectId: string;
  removalId: string | null;
  externalRemovalId: string | null;
}

async function createFixture(
  { seedOpenRemoval = true }: { seedOpenRemoval?: boolean } = {},
): Promise<Fixture> {
  const runId = crypto.randomUUID().slice(0, 8);
  const externalProjectId = `prj_ggs_bd_${runId}`;
  const [facility] = await db
    .insert(facilities)
    .values({ organizationId: TEST_ORG_ID, name: `GGS Boundary Facility ${runId}`, code: `FAC-GB-${runId}` })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: "isometric",
    externalProjectId,
  });
  let removalId: string | null = null;
  let externalRemovalId: string | null = null;
  if (seedOpenRemoval) {
    // The empty-statement guard (#245) predicts period membership from the
    // facility's open removals — an already-submitted removal (latest ledger
    // row carries an externalId) completed inside the window. Seed one so
    // creates get past the guard to the registry boundary under test.
    const [removal] = await db
      .insert(certifierRemovals)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, completedOn: IN_WINDOW_COMPLETED_ON })
      .returning({ id: certifierRemovals.id });
    removalId = removal.id;
    externalRemovalId = `rmv_ggs_bd_${runId}`;
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
      externalId: externalRemovalId,
      version: 1,
      status: "submitted",
    });
  }
  vi.mocked(authServer.getUser).mockResolvedValue({
    id: `test-user-ggs-${runId}`,
    email: `ggs-${runId}@example.com`,
    name: "Boundary Tester",
    emailVerified: true,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  vi.mocked(authServer.requireOrgContext).mockResolvedValue(
    makeTestOrgContext(`test-user-ggs-${runId}`),
  );
  return {
    facilityId: facility.id,
    externalProjectId,
    removalId,
    externalRemovalId,
  };
}

async function latestLedgerRow(facilityId: string) {
  const [statement] = await db
    .select({ id: certifierGhgStatements.id })
    .from(certifierGhgStatements)
    .where(eq(certifierGhgStatements.facilityId, facilityId));
  if (!statement) return null;
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.localEntityId, statement.id));
  return row ?? null;
}

async function staleifyLock(rowId: string): Promise<void> {
  await db
    .update(certificationSubmissions)
    .set({ lockedAt: new Date(Date.now() - STALE_LOCK_OFFSET_MS) })
    .where(eq(certificationSubmissions.id, rowId));
}

let registry: FakeIsometricRegistry;

beforeEach(() => {
  registry = installFakeRegistry();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


beforeAll(() => ensureTestOrg());

describe("loadGhgStatementsForFacility boundary", () => {
  it("serves the local mirror without contacting or reconciling the registry", async () => {
    const fixture = await createFixture();
    registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });
    const syncResult = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(syncResult.success).toBe(true);
    const requestCountBeforeLoad = registry.requests.length;

    const result = await loadGhgStatementsForFacility(fixture.facilityId);

    expect(result).toMatchObject({
      success: true,
      data: [{ linkedRemovalCount: 1 }],
    });
    expect(registry.requests).toHaveLength(requestCountBeforeLoad);
  });
});

describe("createGhgStatementDraft boundary — empty-statement guard (#245)", () => {
  it("uses an unsynced remote period to exclude its Removal from a later window", async () => {
    const fixture = await createFixture();
    registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      startOn: "2026-01-01",
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });

    const result = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: "2026-06-30",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("no submitted Removals");
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(0);
  });

  it("fail-closes before the registry when the period holds no submitted removals", async () => {
    const fixture = await createFixture({ seedOpenRemoval: false });

    const result = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no submitted removals/i);

    // Refused before anything was minted: no registry POST, no local
    // statement row, no ledger draft.
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(0);
    expect(registry.ghgStatements).toHaveLength(0);
    expect(await latestLedgerRow(fixture.facilityId)).toBeNull();
  });
});

describe("registry-list GHG statement reconciliation", () => {
  it("recovers a remote statement into zero local rows and links its removal", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });

    const before = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(before).toHaveLength(0);

    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(result).toMatchObject({
      success: true,
      data: { reconciledCount: 1 },
    });

    const [statement] = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(statement).toBeDefined();
    const [submission] = await db
      .select()
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.localEntityId, statement.id));
    expect(submission).toMatchObject({
      externalId: remote.id,
      status: "submitted",
    });
    const [removal] = await db
      .select()
      .from(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId!));
    expect(removal.ghgStatementId).toBe(statement.id);
  });

  it("does not steal a removal already owned by another local statement", async () => {
    const fixture = await createFixture();
    const [owner] = await db
      .insert(certifierGhgStatements)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        reportingPeriodEndOn: "2025-12-31",
      })
      .returning();
    await db
      .update(certifierRemovals)
      .set({ ghgStatementId: owner.id })
      .where(eq(certifierRemovals.id, fixture.removalId!));
    registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });

    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(result.success).toBe(true);
    const [removal] = await db
      .select()
      .from(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId!));
    expect(removal.ghgStatementId).toBe(owner.id);
  });

  it("reconciles a null-period DRAFT without adopting it for a dated create", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: null,
    });

    const synced = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(synced.success).toBe(true);
    const created = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(created).toMatchObject({
      success: true,
    });
    if (!created.success) return;
    expect(created.data.externalId).not.toBe(remote.id);
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(1);
  });

  it("converges concurrent reconciliation on one local registry identity", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: null,
      ghgEntryIds: [fixture.externalRemovalId!],
    });

    const results = await Promise.all([
      reconcileGhgStatementsFromRegistry(fixture.facilityId),
      reconcileGhgStatementsFromRegistry(fixture.facilityId),
    ]);

    expect(results.every((result) => result.success)).toBe(true);
    const rows = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({
      remoteExternalId: remote.id,
    });
    const submissions = await db
      .select()
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.localEntityId, rows[0].id));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      externalId: remote.id,
      status: "submitted",
    });
  });

  it("replaces a null-period surrogate when the registry assigns a real end and preserves metadata", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: null,
      ghgEntryIds: [fixture.externalRemovalId!],
    });

    await reconcileGhgStatementsFromRegistry(fixture.facilityId);
    const [initial] = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    await db
      .update(certifierGhgStatements)
      .set({
        metadata: {
          ...(initial.metadata as Record<string, unknown>),
          preservedKey: "preserved",
        },
      })
      .where(eq(certifierGhgStatements.id, initial.id));

    remote.reporting_period_start_at = "2026-01-01";
    remote.reporting_period_end_at = REPORTING_PERIOD_END;
    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );

    expect(result.success).toBe(true);
    const [updated] = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.id, initial.id));
    expect(updated.reportingPeriodEndOn).toBe(REPORTING_PERIOD_END);
    expect(updated.metadata).toMatchObject({
      preservedKey: "preserved",
      remotePeriodMissing: false,
      remotePeriodEndOn: REPORTING_PERIOD_END,
      remotePeriodEndIsSynthetic: false,
    });
  });

  it.each([
    { label: "the same real end", endOn: REPORTING_PERIOD_END },
    { label: "no period", endOn: null },
  ])("keeps distinct local identities for remotes with $label", async ({ endOn }) => {
    const fixture = await createFixture({ seedOpenRemoval: false });
    const first = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn,
    });
    const second = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn,
    });

    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        reconciledCount: 2,
        warningCount: 0,
      },
    });
    const rows = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.reportingPeriodEndOn)).size).toBe(2);
    const submissions = await db
      .select()
      .from(certificationSubmissions)
      .where(inArray(
        certificationSubmissions.localEntityId,
        rows.map((row) => row.id),
      ));
    expect(new Set(submissions.map((row) => row.externalId))).toEqual(
      new Set([first.id, second.id]),
    );
  });

  it("assigns a shared-project statement only to the facility owning its removal", async () => {
    const owner = await createFixture();
    const neighbour = await createFixture();
    await db
      .update(certifierProjects)
      .set({ externalProjectId: owner.externalProjectId })
      .where(eq(certifierProjects.facilityId, neighbour.facilityId));
    const remote = registry.seedGhgStatement({
      projectId: owner.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [owner.externalRemovalId!],
    });

    const neighbourResult = await reconcileGhgStatementsFromRegistry(
      neighbour.facilityId,
    );
    expect(neighbourResult).toMatchObject({
      success: true,
      data: { reconciledCount: 0, warningCount: 1 },
    });
    expect(await latestLedgerRow(neighbour.facilityId)).toBeNull();

    const ownerResult = await reconcileGhgStatementsFromRegistry(
      owner.facilityId,
    );
    expect(ownerResult).toMatchObject({
      success: true,
      data: { reconciledCount: 1 },
    });
    expect(await latestLedgerRow(owner.facilityId)).toMatchObject({
      externalId: remote.id,
      status: "submitted",
    });
  });

  it("fails loudly when one shared-project statement spans facilities", async () => {
    const owner = await createFixture();
    const neighbour = await createFixture();
    await db
      .update(certifierProjects)
      .set({ externalProjectId: owner.externalProjectId })
      .where(eq(certifierProjects.facilityId, neighbour.facilityId));
    registry.seedGhgStatement({
      projectId: owner.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [
        owner.externalRemovalId!,
        neighbour.externalRemovalId!,
      ],
    });

    const result = await reconcileGhgStatementsFromRegistry(owner.facilityId);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/multiple noma facilities/i),
    });
    expect(await latestLedgerRow(owner.facilityId)).toBeNull();
    expect(await latestLedgerRow(neighbour.facilityId)).toBeNull();
  });

  it("does not discover a duplicate while an operator create is in flight", async () => {
    const fixture = await createFixture();
    const [local] = await db
      .insert(certifierGhgStatements)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        reportingPeriodEndOn: REPORTING_PERIOD_END,
      })
      .returning();
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "ghg_statement",
      localEntityType: "ghgStatement",
      localEntityId: local.id,
      version: 1,
      status: "draft",
      lockedAt: new Date(),
    });
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });

    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(result).toMatchObject({
      success: true,
      data: { reconciledCount: 0, warningCount: 1 },
    });
    expect(
      registry.requestCount("GET", `/ghg_statements/${remote.id}`),
    ).toBe(0);
    const rows = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(rows).toEqual([expect.objectContaining({ id: local.id })]);

    const [draft] = await db
      .select()
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.localEntityId, local.id));
    await staleifyLock(draft.id);
    const resumed = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(resumed).toMatchObject({
      success: true,
      data: { reconciledCount: 1 },
    });
    expect(await latestLedgerRow(fixture.facilityId)).toMatchObject({
      status: "submitted",
    });
  });

  it("serializes sync behind an operator create and skips after the locked re-check", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });
    const operatorCtx = makeTestOrgContext("test-user-ggs-interleaving");
    const { statement: operatorStatement } =
      await getOrCreateGhgStatementDraft(operatorCtx, {
        facilityId: fixture.facilityId,
        reportingPeriodEndOn: REPORTING_PERIOD_END,
      });
    let releaseOperator!: () => void;
    const holdOperator = new Promise<void>((resolve) => {
      releaseOperator = resolve;
    });
    let signalDraftReady!: () => void;
    const draftReady = new Promise<void>((resolve) => {
      signalDraftReady = resolve;
    });

    const operatorCreate = withDedicatedLockConnection(async (tx) => {
      await acquireFacilityDurabilityLock(
        operatorCtx,
        tx,
        fixture.facilityId,
      );
      const semanticPayload = {
        projectId: fixture.externalProjectId,
        ghgStatementId: operatorStatement.id,
        endOn: REPORTING_PERIOD_END,
      };
      const claimed = await claimSubmissionDraft(
        operatorCtx,
        {
          key: {
            provider: "isometric",
            submissionType: "ghg_statement",
            localEntityType: "ghgStatement",
            localEntityId: operatorStatement.id,
          },
          guard: {
            facilityId: fixture.facilityId,
            provider: "isometric",
            expectedExternalProjectId: fixture.externalProjectId,
          },
          policy: { onSubmittedHashChanged: "invalid-changed-hash" },
          tentativeInputs: semanticPayload,
          hashOf: payloadHash,
          buildSnapshot: ({ inputs }) => ({
            payloadSnapshot: { semantic: inputs },
          }),
        },
        tx,
      );
      expect(claimed.kind).toBe("claimed");
      signalDraftReady();
      await holdOperator;
      return operatorStatement.id;
    });

    await draftReady;
    const sync = reconcileGhgStatementsFromRegistry(fixture.facilityId);
    let syncSettled = false;
    void sync.then(
      () => { syncSettled = true; },
      () => { syncSettled = true; },
    );
    // Authoritative detail now stays behind the shared facility lock. Sync
    // must wait without taking a snapshot that could become stale.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(syncSettled).toBe(false);
    expect(
      registry.requestCount("GET", `/ghg_statements/${remote.id}`),
    ).toBe(0);
    releaseOperator();

    const [operatorStatementId, syncResult] = await Promise.all([
      operatorCreate,
      sync,
    ]);
    expect(syncResult).toMatchObject({
      success: true,
      data: {
        reconciledCount: 0,
        warningCount: 1,
        skippedCount: 1,
      },
    });
    expect(
      registry.requestCount("GET", `/ghg_statements/${remote.id}`),
    ).toBe(0);

    const statements = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      id: operatorStatementId,
      metadata: null,
    });
    const submissions = await db
      .select()
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.localEntityId, operatorStatementId));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      status: "draft",
      externalId: null,
    });
    const [removal] = await db
      .select({ ghgStatementId: certifierRemovals.ghgStatementId })
      .from(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId!));
    expect(removal.ghgStatementId).toBeNull();
  });

  it("unlinks a removal when registry membership shrinks to empty", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });
    await reconcileGhgStatementsFromRegistry(fixture.facilityId);

    remote.ghg_entry_ids = [];
    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(result).toMatchObject({
      success: true,
      data: { reconciledCount: 1 },
    });
    const [removal] = await db
      .select()
      .from(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId!));
    expect(removal.ghgStatementId).toBeNull();
  });

  it("reconciles membership from statement detail when the list summary is stale", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });
    registry.overrideListedGhgStatement(remote.id, {
      ghg_entry_ids: [],
    });

    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );

    expect(result).toMatchObject({
      success: true,
      data: { reconciledCount: 1 },
    });
    const [removal] = await db
      .select()
      .from(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId!));
    expect(removal.ghgStatementId).not.toBeNull();
    expect(
      registry.requestCount("GET", `/ghg_statements/${remote.id}`),
    ).toBe(1);
  });

  it("moves a removal between statements in one registry sweep", async () => {
    const fixture = await createFixture();
    const destination = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: "2026-06-30",
      ghgEntryIds: [],
    });
    const source = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [fixture.externalRemovalId!],
    });
    await reconcileGhgStatementsFromRegistry(fixture.facilityId);

    destination.ghg_entry_ids = [fixture.externalRemovalId!];
    source.ghg_entry_ids = [];
    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(result).toMatchObject({
      success: true,
      data: { reconciledCount: 2 },
    });
    const [destinationSubmission] = await db
      .select()
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.externalId, destination.id));
    const [removal] = await db
      .select()
      .from(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId!));
    expect(removal.ghgStatementId).toBe(
      destinationSubmission.localEntityId,
    );
  });

  it("refuses a matching non-DRAFT and names its id and status", async () => {
    const fixture = await createFixture();
    const remote = registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      startOn: "2026-01-01",
      endOn: REPORTING_PERIOD_END,
      status: "VERIFIED",
    });

    const result = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain(remote.id);
    expect(result.error).toContain("VERIFIED");
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(0);
  });

  it("reconciles every page of the project statement list", async () => {
    const fixture = await createFixture({ seedOpenRemoval: false });
    const statementCount = 51;
    for (let index = 0; index < statementCount; index += 1) {
      registry.seedGhgStatement({
        projectId: fixture.externalProjectId,
        endOn: addDaysIso("2026-01-01", index),
      });
    }

    const result = await reconcileGhgStatementsFromRegistry(
      fixture.facilityId,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        reconciledCount: statementCount,
        warningCount: 0,
      },
    });
    expect(registry.requestCount("GET", "/ghg_statements")).toBe(2);
    const rows = await db
      .select()
      .from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    expect(rows).toHaveLength(statementCount);
  });
});
