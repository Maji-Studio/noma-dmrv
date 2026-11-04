import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { TEST_SITE_POSITION, ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const limits = vi.hoisted(() => ({ lockTimeoutMs: 3_000 }));

// Real connections and locks, with a deadline so a regression rolls back and
// releases its connection even when it waits on its own outer session lock.
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const { sql } = await import("drizzle-orm");
  return {
    ...actual,
    withDedicatedLockConnection: <T>(fn: (tx: import("@/db").DbTransaction) => Promise<T>) =>
      actual.withDedicatedLockConnection(async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout', ${String(limits.lockTimeoutMs)}, true)`);
        return fn(tx);
      }),
  };
});
vi.mock("@/data-access/certifier-credentials", async (importOriginal) =>
  (await import("./fixtures/fake-registry")).fakeCredentialsModule(importOriginal),
);
vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});
vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return { ...actual, requireOrgContext: vi.fn() };
});

import { db, withDedicatedLockConnection } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { claimSubmissionDraft } from "@/data-access/certification-submissions";
import { withFacilityCertificationBoundarySessionLock } from "@/data-access/facility-certification-boundary-lock";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import {
  reconcileGhgStatementsForFacility,
  reconcileRegistryGhgStatementById,
} from "@/fn/certification/ghg-statement-reconciliation";
import { createGhgStatementDraft } from "@/fn/certification/ghg-statements";
import { requireOrgContext } from "@/lib/auth/server";
import { payloadHash } from "@/lib/isometric";
import { installFakeRegistry, type FakeIsometricRegistry } from "./fixtures/fake-registry";

const REPORTING_PERIOD_END = "2026-03-31";
const POLL_INTERVAL_MS = 20;
const OPERATION_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 20_000;
const createdFacilityIds: string[] = [];
const ctx = makeTestOrgContext("test-user-ghg-lock-order");
let registry: FakeIsometricRegistry;

beforeAll(() => ensureTestOrg());
beforeEach(() => {
  registry = installFakeRegistry();
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
});

afterAll(async () => {
  if (!createdFacilityIds.length) return;
  const statements = await db.select({ id: certifierGhgStatements.id })
    .from(certifierGhgStatements)
    .where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
  const removals = await db.select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(inArray(certifierRemovals.facilityId, createdFacilityIds));
  const entityIds = [...statements, ...removals].map(({ id }) => id);
  if (entityIds.length) {
    await db.delete(activityEvents).where(inArray(activityEvents.entityId, entityIds));
    await db.delete(certifierSyncEvents).where(inArray(certifierSyncEvents.entityId, entityIds));
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.localEntityId, entityIds));
  }
  await db.delete(certifierRemovals).where(inArray(certifierRemovals.facilityId, createdFacilityIds));
  await db.delete(certifierGhgStatements).where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
  await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, createdFacilityIds));
  await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
});

async function createFixture() {
  const runId = crypto.randomUUID();
  const externalProjectId = `prj_lock_order_${runId}`;
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION,
    timezone: "UTC",
    organizationId: TEST_ORG_ID,
    name: `Lock Order ${runId}`,
    code: `FAC-LO-${runId}`,
  }).returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: "isometric",
    externalFacilityId: `fcl_${runId}`,
    externalProjectId,
  });
  const [removal] = await insertRemovalFixture(db, {
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    completedOn: "2026-03-15",
  });
  const remote = registry.seedGhgStatement({
    projectId: externalProjectId,
    endOn: REPORTING_PERIOD_END,
  });
  return { facilityId: facility.id, removalId: removal.id, externalProjectId, remote };
}

async function withinDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Lock operation timed out")), OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForAdvisoryWaiter(pid: number): Promise<void> {
  const deadline = Date.now() + limits.lockTimeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select 1 from pg_locks
      where pid = ${pid} and locktype = 'advisory' and granted = false
    `);
    if (result.rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Removal claim never waited on an advisory lock");
}

describe("GHG reconciliation lock order", () => {
  it.each(["facility sweep", "by id"] as const)("serializes %s with a Removal claim", async (path) => {
    const fixture = await createFixture();
    const client = await resolveIsometricClient(ctx);
    const detail = registry.deferNextResponse(`GET /ghg_statements/${fixture.remote.id}`);
    const reconciliation: Promise<unknown> = path === "facility sweep"
      ? reconcileGhgStatementsForFacility(ctx, fixture.facilityId)
      : reconcileRegistryGhgStatementById(ctx, {
          client,
          facilityId: fixture.facilityId,
          externalProjectId: fixture.externalProjectId,
          externalId: fixture.remote.id,
        });
    // Observe rejection immediately, including before the detail barrier starts.
    void reconciliation.catch(() => undefined);
    let removalClaim: Promise<unknown> | undefined;
    try {
      await withinDeadline(detail.started);
      let announcePid!: (pid: number) => void;
      const pidReady = new Promise<number>((resolve) => { announcePid = resolve; });
      removalClaim = withDedicatedLockConnection(async (tx) => {
        const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        announcePid(result.rows[0].pid);
        return claimSubmissionDraft(ctx, {
          key: {
            provider: "isometric",
            submissionType: "removal",
            localEntityType: "removal",
            localEntityId: fixture.removalId,
          },
          guard: {
            provider: "isometric",
            facilityId: fixture.facilityId,
            expectedExternalProjectId: fixture.externalProjectId,
          },
          policy: { onSubmittedHashChanged: "invalid-changed-hash" },
          tentativeInputs: { removalId: fixture.removalId },
          hashOf: payloadHash,
          buildSnapshot: ({ inputs }) => ({ payloadSnapshot: inputs }),
        }, tx);
      });
      // Attach a handler before checking pg_locks so failures cannot be unhandled.
      void removalClaim.catch(() => undefined);
      await waitForAdvisoryWaiter(await withinDeadline(pidReady));
      // Before the fix the Removal holds boundary and waits for durability.
      // Releasing detail then makes reconciliation request boundary: a cycle.
      // After the fix the Removal waits for boundary, holding neither lock.
      detail.release();
      await expect(withinDeadline(reconciliation)).resolves.toMatchObject(
        path === "facility sweep"
          ? { reconciledCount: 1 }
          : { externalId: fixture.remote.id },
      );
      await expect(withinDeadline(removalClaim)).resolves.toMatchObject({ kind: "claimed" });
      const rows = await db.select().from(certifierGhgStatements)
        .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
      expect(rows).toHaveLength(1);
    } finally {
      detail.release();
      await Promise.allSettled([reconciliation, ...(removalClaim ? [removalClaim] : [])]);
    }
  }, TEST_TIMEOUT_MS);

  it("claims an unrecorded statement while the caller holds boundary by session", async () => {
    const fixture = await createFixture();
    const client = await resolveIsometricClient(ctx);
    await expect(withinDeadline(withFacilityCertificationBoundarySessionLock(
      ctx,
      fixture.facilityId,
      () => reconcileRegistryGhgStatementById(ctx, {
        client,
        facilityId: fixture.facilityId,
        externalProjectId: fixture.externalProjectId,
        externalId: fixture.remote.id,
        boundaryLockHeldBySession: true,
      }),
    ))).resolves.toMatchObject({ externalId: fixture.remote.id });
  }, TEST_TIMEOUT_MS);

  it("reuses the create caller's boundary session lock for an existing submitted mirror", async () => {
    const fixture = await createFixture();
    await reconcileGhgStatementsForFacility(ctx, fixture.facilityId);
    const [statement] = await db.select().from(certifierGhgStatements)
      .where(eq(certifierGhgStatements.facilityId, fixture.facilityId));
    const [submission] = await db.select().from(certificationSubmissions)
      .where(eq(certificationSubmissions.localEntityId, statement.id));
    expect(submission.status).toBe("submitted");
    const detailPath: `/ghg_statements/${string}` = `/ghg_statements/${fixture.remote.id}`;
    const previousFetches = registry.requestCount("GET", detailPath);
    await expect(withinDeadline(createGhgStatementDraft({
      facilityId: fixture.facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
      confirmProduction: true,
    }))).resolves.toMatchObject({
      success: true,
      data: { outcome: "existing", ghgStatementId: statement.id, externalId: fixture.remote.id },
    });
    expect(registry.requestCount("GET", detailPath)).toBe(previousFetches + 1);
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(0);
  }, TEST_TIMEOUT_MS);
});
