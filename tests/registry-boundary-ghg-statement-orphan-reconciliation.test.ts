import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

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
const IN_WINDOW_COMPLETED_ON = "2026-03-15";
const FIXTURE_UUID_SUFFIX_LENGTH = 8;
const MULTIPLE_DRAFTS_MESSAGE =
  "Multiple draft GHG Statements exist for this project and period in Isometric.";
const STALE_LOCK_OFFSET_MS = LOCK_TTL_MS + 60_000;

const createdFacilityIds: string[] = [];

afterAll(async () => {
  if (createdFacilityIds.length === 0) return;
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

async function createFixture() {
  const runId = crypto.randomUUID().slice(0, FIXTURE_UUID_SUFFIX_LENGTH);
  const externalProjectId = `prj_ggs_bd_${runId}`;
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `GGS Boundary Facility ${runId}`,
      code: `FAC-GB-${runId}`,
    })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: "isometric",
    externalProjectId,
  });
  const [removal] = await db
    .insert(certifierRemovals)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      completedOn: IN_WINDOW_COMPLETED_ON,
    })
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

beforeAll(() => ensureTestOrg());

beforeEach(() => {
  registry = installFakeRegistry();
});

describe("createGhgStatementDraft boundary: orphan reconciliation", () => {
  it("reconciles a dropped draft after its possible-mutation lock expires", async () => {
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

    expect(registry.ghgStatements).toHaveLength(1);
    const orphanId = registry.ghgStatements[0].id;

    let row = await latestLedgerRow(fixture.facilityId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("draft");
    expect(row!.lockedAt).not.toBeNull();
    expect(row!.metadata).toMatchObject({
      lastAttemptOutcome: "interrupted",
      externalMutation: "possible",
    });
    expect(Date.now() - row!.lockedAt!.getTime()).toBeLessThan(LOCK_TTL_MS);

    const immediateRetry = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(immediateRetry).toEqual({
      success: false,
      error: "GHG Statement creation is already in progress.",
    });

    await staleifyLock(row!.id);
    const retryAfterExpiry = await createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(retryAfterExpiry).toMatchObject({
      success: true,
      data: {
        outcome: "existing",
        externalId: orphanId,
      },
    });

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

    const events = await db
      .select()
      .from(certifierSyncEvents)
      .where(eq(certifierSyncEvents.entityId, row!.localEntityId));
    expect(
      events.filter((event) => event.status === "failed"),
    ).toHaveLength(0);
  });
});
