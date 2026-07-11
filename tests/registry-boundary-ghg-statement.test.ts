import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Boundary tests for the GHG Statement create pipeline against the fake
 * registry (reliability-track Phase 3, boundary test 3 — tests 1/2/4/5 live
 * in registry-boundary-removal.test.ts).
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

import { db } from "@/db";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { createGhgStatementDraft } from "@/fn/certification/ghg-statements";
import * as authServer from "@/lib/auth/server";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const REPORTING_PERIOD_END = "2026-03-31";
// Inside the reporting window (first statement → unbounded start, so any
// completion on or before REPORTING_PERIOD_END is in-window).
const IN_WINDOW_COMPLETED_ON = "2026-03-15";
const MULTIPLE_DRAFTS_MESSAGE =
  "Multiple draft GHG statements exist for this project and period in Isometric.";
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
  if (seedOpenRemoval) {
    // The empty-statement guard (#245) predicts period membership from the
    // facility's open removals — an already-submitted removal (latest ledger
    // row carries an externalId) completed inside the window. Seed one so
    // creates get past the guard to the registry boundary under test.
    const [removal] = await db
      .insert(certifierRemovals)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, completedOn: IN_WINDOW_COMPLETED_ON })
      .returning({ id: certifierRemovals.id });
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
      externalId: `rmv_ggs_bd_${runId}`,
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
  return { facilityId: facility.id, externalProjectId };
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

describe("createGhgStatementDraft boundary — orphan reconciliation (test 3)", () => {
  it("resume reconciles the single dropped draft by (project, end_on) and finalizes without re-POSTing", async () => {
    const fixture = await createFixture();
    // The create commits server-side; the client sees a network error and
    // the in-attempt lookup is also down — orphan + locked draft left behind.
    registry.failNext("POST /ghg_statements", "drop-after-commit");
    // The create path now checks for an existing exact-period draft before
    // POSTing. Let that preflight return none, then fail the recovery lookup.
    registry.passNext("GET /ghg_statements");
    registry.failNext("GET /ghg_statements", "reject-before-commit", {
      status: 503,
    });

    const first = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(first.success).toBe(false);

    expect(registry.ghgStatements).toHaveLength(1);
    const orphanId = registry.ghgStatements[0].id;

    let row = await latestLedgerRow(fixture.facilityId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("draft");
    expect(row!.lockedAt).not.toBeNull();

    await staleifyLock(row!.id);

    const second = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(second).toMatchObject({
      success: true,
      data: { externalId: orphanId },
    });

    // Reconciled, never re-POSTed: still exactly one statement server-side.
    expect(registry.ghgStatements).toHaveLength(1);
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(1);

    row = await latestLedgerRow(fixture.facilityId);
    expect(row).toMatchObject({
      status: "submitted",
      externalId: orphanId,
      version: 1,
    });

    const events = await db
      .select()
      .from(certifierSyncEvents)
      .where(eq(certifierSyncEvents.entityId, row!.localEntityId));
    expect(
      events.map((event) => `${event.operation}:${event.status}`),
    ).toContain("ghg_statement:create:reconciled:succeeded");
  });

  it("rejects with the ambiguity message when the period holds two drafts", async () => {
    const fixture = await createFixture();
    registry.failNext("POST /ghg_statements", "drop-after-commit");
    registry.passNext("GET /ghg_statements");
    registry.failNext("GET /ghg_statements", "reject-before-commit", {
      status: 503,
    });

    const first = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(first.success).toBe(false);

    // A second DRAFT for the same (project, end_on) appears server-side —
    // e.g. created out-of-band in the registry UI. The lookup is no longer
    // unique, so the resume must refuse rather than guess.
    registry.seedGhgStatement({
      projectId: fixture.externalProjectId,
      endOn: REPORTING_PERIOD_END,
    });

    let row = await latestLedgerRow(fixture.facilityId);
    await staleifyLock(row!.id);

    const second = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(second).toEqual({ success: false, error: MULTIPLE_DRAFTS_MESSAGE });

    expect(registry.requestCount("POST", "/ghg_statements")).toBe(1);

    row = await latestLedgerRow(fixture.facilityId);
    expect(row!.status).toBe("rejected");
    expect(row!.externalId).toBeNull();
    expect(row!.metadata).toMatchObject({
      lastError: MULTIPLE_DRAFTS_MESSAGE,
    });

    // Phase 2 parity: the ambiguous rejection records NO failed sync event —
    // the rejection itself carries the message. Undecided whether that audit
    // silence should stay (docs/open-questions.md,
    // `isometric/ambiguous-lookup-audit-silence`); flip this assertion when
    // it's resolved.
    const events = await db
      .select()
      .from(certifierSyncEvents)
      .where(eq(certifierSyncEvents.entityId, row!.localEntityId));
    expect(
      events.filter((event) => event.status === "failed"),
    ).toHaveLength(0);
  });
});

describe("createGhgStatementDraft boundary — empty-statement guard (#245)", () => {
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
