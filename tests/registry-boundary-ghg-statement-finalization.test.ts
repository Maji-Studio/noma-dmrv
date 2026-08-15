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
vi.mock("@/fn/certification/ghg-statement-finalization", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/fn/certification/ghg-statement-finalization")
    >();
  return {
    ...actual,
    finalizeGhgStatement: vi.fn(actual.finalizeGhgStatement),
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
import { finalizeGhgStatement } from "@/fn/certification/ghg-statement-finalization";
import * as authServer from "@/lib/auth/server";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";

const REPORTING_PERIOD_END = "2026-03-31";
const FIXTURE_UUID_SUFFIX_LENGTH = 8;
const STALE_LOCK_MARGIN_MS = 60_000;
const STALE_LOCK_OFFSET_MS = LOCK_TTL_MS + STALE_LOCK_MARGIN_MS;
const createdFacilityIds: string[] = [];
let registry: FakeIsometricRegistry;

beforeAll(() => ensureTestOrg());

beforeEach(() => {
  registry = installFakeRegistry();
});

afterAll(async () => {
  if (createdFacilityIds.length === 0) return;
  const removals = await db
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(inArray(certifierRemovals.facilityId, createdFacilityIds));
  const removalIds = removals.map((row) => row.id);
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
  const statementIds = statements.map((row) => row.id);
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

async function createFixture(): Promise<string> {
  const runId = crypto.randomUUID().slice(0, FIXTURE_UUID_SUFFIX_LENGTH);
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `GGS Finalization Facility ${runId}`,
      code: `FAC-GF-${runId}`,
    })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: "isometric",
    externalProjectId: `prj_ggs_final_${runId}`,
  });
  const [removal] = await db
    .insert(certifierRemovals)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      completedOn: "2026-03-15",
    })
    .returning({ id: certifierRemovals.id });
  await db.insert(certificationSubmissions).values({
    organizationId: TEST_ORG_ID,
    provider: "isometric",
    submissionType: "removal",
    localEntityType: "removal",
    localEntityId: removal.id,
    externalId: `rmv_ggs_final_${runId}`,
    version: 1,
    status: "submitted",
  });
  const userId = `test-user-ggs-final-${runId}`;
  vi.mocked(authServer.requireOrgContext).mockResolvedValue(
    makeTestOrgContext(userId),
  );
  return facility.id;
}

async function latestStatementRow(facilityId: string) {
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

describe("createGhgStatementDraft finalization recovery", () => {
  it("marks a confirmed remote create interrupted and reconciles it immediately", async () => {
    const facilityId = await createFixture();
    vi.mocked(finalizeGhgStatement).mockRejectedValueOnce(
      new Error("injected local finalization failure"),
    );

    const first = await createGhgStatementDraft({
      facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(first.success).toBe(false);
    expect(registry.ghgStatements).toHaveLength(1);
    expect(await latestStatementRow(facilityId)).toMatchObject({
      status: "draft",
      externalId: registry.ghgStatements[0].id,
      metadata: {
        lastAttemptOutcome: "interrupted",
        externalMutation: "confirmed",
      },
    });

    const second = await createGhgStatementDraft({
      facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(second).toMatchObject({
      success: true,
      data: { outcome: "existing" },
    });
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(1);
    expect(await latestStatementRow(facilityId)).toMatchObject({
      status: "submitted",
      externalId: registry.ghgStatements[0].id,
    });
  });

  it("marks a reconciled remote create confirmed when local finalization fails", async () => {
    const facilityId = await createFixture();
    registry.failNext("POST /ghg_statements", "drop-after-commit");
    registry.passNext("GET /ghg_statements");
    registry.failNext("GET /ghg_statements", "reject-before-commit", {
      status: 503,
    });

    const first = await createGhgStatementDraft({
      facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(first.success).toBe(false);

    const interrupted = await latestStatementRow(facilityId);
    expect(interrupted).not.toBeNull();
    await db
      .update(certificationSubmissions)
      .set({ lockedAt: new Date(Date.now() - STALE_LOCK_OFFSET_MS) })
      .where(eq(certificationSubmissions.id, interrupted!.id));

    const orphan = registry.ghgStatements.pop();
    if (!orphan) throw new Error("Expected the dropped registry statement");
    const deferredPreflight = registry.deferNextResponse(
      "GET /ghg_statements",
    );
    vi.mocked(finalizeGhgStatement).mockRejectedValueOnce(
      new Error("injected reconciled finalization failure"),
    );
    const retry = createGhgStatementDraft({
      facilityId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    await deferredPreflight.started;
    registry.ghgStatements.push(orphan);
    deferredPreflight.release();

    await expect(retry).resolves.toMatchObject({ success: false });
    expect(registry.requestCount("POST", "/ghg_statements")).toBe(1);
    expect(await latestStatementRow(facilityId)).toMatchObject({
      status: "draft",
      externalId: orphan.id,
      metadata: {
        lastAttemptOutcome: "interrupted",
        externalMutation: "confirmed",
      },
    });
  });
});
