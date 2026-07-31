import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Real-Postgres lock-order regressions for GHG Statement remote-state writes.
 *
 * The fake registry can freeze a captured detail response while its live state
 * advances. That makes the stale-snapshot race deterministic while every
 * local transaction, advisory lock, membership write, and ledger write stays
 * real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

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
import { refreshGhgStatementStatus } from "@/fn/certification/ghg-statements";
import { reconcileGhgStatementsFromRegistry } from "@/fn/certification/ghg-statement-sync";
import * as authServer from "@/lib/auth/server";
import {
  installFakeRegistry,
  type FakeGhgStatementRecord,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const REPORTING_PERIOD_END = "2026-03-31";
const LOCK_OBSERVATION_DELAY_MS = 200;
const createdFacilityIds: string[] = [];

interface Fixture {
  facilityId: string;
  firstRemovalId: string;
  secondRemovalId: string;
  firstExternalRemovalId: string;
  secondExternalRemovalId: string;
  remote: FakeGhgStatementRecord;
  submissionId: string;
}

let registry: FakeIsometricRegistry;

beforeAll(() => ensureTestOrg());

beforeEach(() => {
  registry = installFakeRegistry();
});

afterAll(async () => {
  if (createdFacilityIds.length === 0) return;
  const statements = await db
    .select({ id: certifierGhgStatements.id })
    .from(certifierGhgStatements)
    .where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
  const statementIds = statements.map((statement) => statement.id);
  const removals = await db
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(inArray(certifierRemovals.facilityId, createdFacilityIds));
  const removalIds = removals.map((removal) => removal.id);
  if (statementIds.length > 0) {
    await db
      .delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, statementIds));
  }
  const localEntityIds = [...statementIds, ...removalIds];
  if (localEntityIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, localEntityIds));
  }
  if (removalIds.length > 0) {
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, removalIds));
  }
  if (statementIds.length > 0) {
    await db
      .delete(certifierGhgStatements)
      .where(inArray(certifierGhgStatements.id, statementIds));
  }
  await db
    .delete(certifierProjects)
    .where(inArray(certifierProjects.facilityId, createdFacilityIds));
  await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
});

async function createFixture(): Promise<Fixture> {
  const runId = crypto.randomUUID().slice(0, 8);
  const externalProjectId = `prj_ggs_lock_${runId}`;
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `GGS Lock Facility ${runId}`,
      code: `FAC-GL-${runId}`,
    })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: "isometric",
    externalProjectId,
  });

  const externalRemovalIds = [
    `rmv_ggs_lock_a_${runId}`,
    `rmv_ggs_lock_b_${runId}`,
  ];
  const removalRows = await db
    .insert(certifierRemovals)
    .values(
      externalRemovalIds.map(() => ({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        completedOn: "2026-03-15",
      })),
    )
    .returning({ id: certifierRemovals.id });
  await db.insert(certificationSubmissions).values(
    removalRows.map((removal, index) => ({
      organizationId: TEST_ORG_ID,
      provider: "isometric" as const,
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
      externalId: externalRemovalIds[index],
      version: 1,
      status: "submitted" as const,
    })),
  );

  const userId = `test-user-ggs-lock-${runId}`;
  vi.mocked(authServer.getUser).mockResolvedValue({
    id: userId,
    email: `${userId}@example.com`,
    name: "Lock Tester",
    emailVerified: true,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  vi.mocked(authServer.requireOrgContext).mockResolvedValue(
    makeTestOrgContext(userId),
  );

  const remote = registry.seedGhgStatement({
    projectId: externalProjectId,
    endOn: REPORTING_PERIOD_END,
    ghgEntryIds: [externalRemovalIds[0]],
  });
  const initial = await reconcileGhgStatementsFromRegistry(facility.id);
  expect(initial).toMatchObject({
    success: true,
    data: { reconciledCount: 1 },
  });
  const [statement] = await db
    .select({ id: certifierGhgStatements.id })
    .from(certifierGhgStatements)
    .where(eq(certifierGhgStatements.facilityId, facility.id));
  const [submission] = await db
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.localEntityId, statement.id));

  return {
    facilityId: facility.id,
    firstRemovalId: removalRows[0].id,
    secondRemovalId: removalRows[1].id,
    firstExternalRemovalId: externalRemovalIds[0],
    secondExternalRemovalId: externalRemovalIds[1],
    remote,
    submissionId: submission.id,
  };
}

function advanceRemote(fixture: Fixture): void {
  fixture.remote.status = "VERIFIED";
  fixture.remote.ghg_entry_ids = [fixture.secondExternalRemovalId];
}

async function expectFresherState(fixture: Fixture): Promise<void> {
  const removals = await db
    .select({
      id: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(certifierRemovals)
    .where(
      inArray(certifierRemovals.id, [
        fixture.firstRemovalId,
        fixture.secondRemovalId,
      ]),
    );
  const membership = new Map(
    removals.map((removal) => [removal.id, removal.ghgStatementId]),
  );
  expect(membership.get(fixture.firstRemovalId)).toBeNull();
  expect(membership.get(fixture.secondRemovalId)).not.toBeNull();

  const [submission] = await db
    .select()
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.id, fixture.submissionId));
  expect(submission).toMatchObject({
    status: "accepted",
    metadata: expect.objectContaining({ remoteStatus: "VERIFIED" }),
  });
}

describe("GHG Statement facility reconciliation lock", () => {
  it("prevents an older sweep detail snapshot from overwriting a fresher sweep", async () => {
    const fixture = await createFixture();
    const detailPath: `/ghg_statements/${string}` =
      `/ghg_statements/${fixture.remote.id}`;
    const staleDetail = registry.deferNextResponse(`GET ${detailPath}`);
    const olderSweep = reconcileGhgStatementsFromRegistry(fixture.facilityId);
    await staleDetail.started;

    advanceRemote(fixture);
    const newerSweep = reconcileGhgStatementsFromRegistry(fixture.facilityId);
    await new Promise((resolve) =>
      setTimeout(resolve, LOCK_OBSERVATION_DELAY_MS),
    );
    staleDetail.release();

    await expect(Promise.all([olderSweep, newerSweep])).resolves.toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true }),
    ]);
    await expectFresherState(fixture);
  });

  it("makes manual refresh wait behind sync and then reconcile fresher state", async () => {
    const fixture = await createFixture();
    const detailPath: `/ghg_statements/${string}` =
      `/ghg_statements/${fixture.remote.id}`;
    const requestCountBefore = registry.requestCount("GET", detailPath);
    const staleDetail = registry.deferNextResponse(`GET ${detailPath}`);
    const sync = reconcileGhgStatementsFromRegistry(fixture.facilityId);
    await staleDetail.started;

    advanceRemote(fixture);
    const refresh = refreshGhgStatementStatus(fixture.submissionId);
    await new Promise((resolve) =>
      setTimeout(resolve, LOCK_OBSERVATION_DELAY_MS),
    );
    expect(registry.requestCount("GET", detailPath)).toBe(
      requestCountBefore + 1,
    );

    staleDetail.release();
    await expect(Promise.all([sync, refresh])).resolves.toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: "VERIFIED" }),
      }),
    ]);
    expect(registry.requestCount("GET", detailPath)).toBe(
      requestCountBefore + 2,
    );
    await expectFresherState(fixture);
  });
});
