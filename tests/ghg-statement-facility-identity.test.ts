/**
 * ADR 0023 — a registry GHG statement's local identity is scoped per
 * (organization, facility), not globally.
 *
 * `certifier_projects` deliberately lets several noma facilities share one
 * Isometric project (migration 0016), but statement identity used to be
 * globally unique per provider, so the first facility to import a registry
 * statement permanently owned it — and a registry id could collide across
 * tenants. These tests pin the new boundary:
 *
 *  1. Two facilities in the SAME organization each hold their own local row
 *     (and their own ledger row) for the SAME registry statement id.
 *  2. A facility in a DIFFERENT organization is fully isolated: it holds its
 *     own row for that id and cannot see the other tenant's.
 *  3. End-to-end through the sync path — the facility a shared project is
 *     re-pointed to can import a statement the previous facility still holds.
 *
 * Requires a real Postgres (`.env.test`), like
 * tests/registry-boundary-ghg-statement.test.ts.
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

import {
  createGhgStatementForRegistryDiscovery,
  getGhgStatementSubmissionForFacility,
  listGhgStatementsForFacility,
} from "@/data-access/certifier-ghg-statements";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
  GHG_STATEMENT_LEDGER_SUBMISSION_TYPE,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { organizations } from "@/db/schema";
import { reconcileGhgStatementsFromRegistry } from "@/fn/certification/ghg-statement-sync";
import * as authServer from "@/lib/auth/server";
import type { OrgContext } from "@/lib/auth/server";
import { GHG_STATEMENT_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const OTHER_ORG_ID = "org_test_ghg_identity_other";
const REPORTING_PERIOD_END = "2026-03-31";
const IN_WINDOW_COMPLETED_ON = "2026-03-15";

const createdFacilityIds: string[] = [];

function makeOtherOrgContext(): OrgContext {
  return {
    userId: "user_test_ghg_identity_other",
    organizationId: OTHER_ORG_ID,
    orgRole: "owner",
    isPlatformAdmin: false,
  };
}

async function createFacility(
  organizationId: string,
  label: string,
): Promise<string> {
  const runId = crypto.randomUUID().slice(0, 8);
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId,
      name: `GGS Identity ${label} ${runId}`,
      code: `FAC-GI-${runId}`,
    })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  return facility.id;
}

beforeAll(async () => {
  await ensureTestOrg();
  await db
    .insert(organizations)
    .values({
      id: OTHER_ORG_ID,
      name: "GHG Identity Other Tenant",
      slug: "ghg-identity-other-tenant",
    })
    .onConflictDoNothing();
});

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
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG_ID));
});

let registry: FakeIsometricRegistry;

beforeEach(() => {
  registry = installFakeRegistry();
});

describe("GHG statement ledger submission type", () => {
  it("keeps the schema-layer literal in step with the shared constant", () => {
    expect(GHG_STATEMENT_LEDGER_SUBMISSION_TYPE).toBe(
      GHG_STATEMENT_SUBMISSION_TYPE,
    );
  });
});

describe("registry statement identity is scoped per (organization, facility)", () => {
  it("gives two facilities sharing one project their own row for the same registry statement", async () => {
    const orgCtx = makeTestOrgContext();
    const facilityA = await createFacility(TEST_ORG_ID, "A");
    const facilityB = await createFacility(TEST_ORG_ID, "B");
    const externalProjectId = `prj_ggs_id_${crypto.randomUUID().slice(0, 8)}`;
    // The shared-project shape migration 0016 deliberately allows.
    await db.insert(certifierProjects).values([
      {
        organizationId: TEST_ORG_ID,
        facilityId: facilityA,
        provider: "isometric" as const,
        externalProjectId,
      },
      {
        organizationId: TEST_ORG_ID,
        facilityId: facilityB,
        provider: "isometric" as const,
        externalProjectId,
      },
    ]);
    const externalId = `ghg_shared_${crypto.randomUUID().slice(0, 8)}`;

    const rowA = await createGhgStatementForRegistryDiscovery(orgCtx, {
      facilityId: facilityA,
      externalId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    const rowB = await createGhgStatementForRegistryDiscovery(orgCtx, {
      facilityId: facilityB,
      externalId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.facilityId).toBe(facilityA);
    expect(rowB.facilityId).toBe(facilityB);
    // Both mirror the SAME registry statement, and each keeps the real period
    // (no synthetic date shuffling — they no longer collide).
    expect(rowA.metadata).toMatchObject({ remoteExternalId: externalId });
    expect(rowB.metadata).toMatchObject({ remoteExternalId: externalId });
    expect(rowA.reportingPeriodEndOn).toBe(REPORTING_PERIOD_END);
    expect(rowB.reportingPeriodEndOn).toBe(REPORTING_PERIOD_END);

    // Idempotent per facility: a repeat discovery resolves to the same row.
    const rowAAgain = await createGhgStatementForRegistryDiscovery(orgCtx, {
      facilityId: facilityA,
      externalId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    expect(rowAAgain.id).toBe(rowA.id);
  });

  it("isolates a facility in another organization holding the same registry id", async () => {
    const orgCtx = makeTestOrgContext();
    const otherCtx = makeOtherOrgContext();
    const facilityHere = await createFacility(TEST_ORG_ID, "Here");
    const facilityThere = await createFacility(OTHER_ORG_ID, "There");
    const externalId = `ghg_tenant_${crypto.randomUUID().slice(0, 8)}`;

    const here = await createGhgStatementForRegistryDiscovery(orgCtx, {
      facilityId: facilityHere,
      externalId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });
    const there = await createGhgStatementForRegistryDiscovery(otherCtx, {
      facilityId: facilityThere,
      externalId,
      reportingPeriodEndOn: REPORTING_PERIOD_END,
    });

    expect(here.id).not.toBe(there.id);
    expect(here.organizationId).toBe(TEST_ORG_ID);
    expect(there.organizationId).toBe(OTHER_ORG_ID);

    // Neither tenant can read across the boundary.
    expect(
      await listGhgStatementsForFacility(orgCtx, facilityThere),
    ).toHaveLength(0);
    expect(
      await listGhgStatementsForFacility(otherCtx, facilityHere),
    ).toHaveLength(0);
    expect(
      (await listGhgStatementsForFacility(orgCtx, facilityHere)).map(
        (row) => row.id,
      ),
    ).toEqual([here.id]);
  });
});

describe("registry sync after a shared project is re-pointed", () => {
  it("lets the newly linked facility import a statement the previous facility still holds", async () => {
    const orgCtx = makeTestOrgContext();
    const runId = crypto.randomUUID().slice(0, 8);
    const externalProjectId = `prj_ggs_rp_${runId}`;
    const facilityA = await createFacility(TEST_ORG_ID, "Prev");
    const facilityB = await createFacility(TEST_ORG_ID, "Next");
    await db.insert(certifierProjects).values({
      organizationId: TEST_ORG_ID,
      facilityId: facilityA,
      provider: "isometric",
      externalProjectId,
    });
    vi.mocked(authServer.getUser).mockResolvedValue({
      id: `test-user-ggs-id-${runId}`,
      email: `ggs-id-${runId}@example.com`,
      name: "Identity Tester",
      emailVerified: true,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(authServer.requireOrgContext).mockResolvedValue(
      makeTestOrgContext(`test-user-ggs-id-${runId}`),
    );

    const remote = registry.seedGhgStatement({
      projectId: externalProjectId,
      endOn: REPORTING_PERIOD_END,
    });

    // Facility A is alone on the project, so it adopts the statement.
    const firstSync = await reconcileGhgStatementsFromRegistry(facilityA);
    expect(firstSync).toMatchObject({
      success: true,
      data: { reconciledCount: 1, skippedCount: 0 },
    });
    const [statementA] = await listGhgStatementsForFacility(orgCtx, facilityA);
    expect(statementA.metadata).toMatchObject({ remoteExternalId: remote.id });

    // The operator re-points the project: A is unlinked, B takes it over. The
    // local row A already holds must not lock B out (the QA finding).
    await db
      .delete(certifierProjects)
      .where(eq(certifierProjects.facilityId, facilityA));
    await db.insert(certifierProjects).values({
      organizationId: TEST_ORG_ID,
      facilityId: facilityB,
      provider: "isometric",
      externalProjectId,
    });

    const secondSync = await reconcileGhgStatementsFromRegistry(facilityB);
    expect(secondSync).toMatchObject({
      success: true,
      data: { reconciledCount: 1, skippedCount: 0 },
    });

    const [statementB] = await listGhgStatementsForFacility(orgCtx, facilityB);
    expect(statementB).toBeDefined();
    expect(statementB.id).not.toBe(statementA.id);
    expect(statementB.metadata).toMatchObject({ remoteExternalId: remote.id });

    // Each facility owns its own ledger row for the same remote id, and the
    // facility-scoped lookup resolves each to its own.
    const ledgerA = await getGhgStatementSubmissionForFacility(orgCtx, {
      facilityId: facilityA,
      externalId: remote.id,
    });
    const ledgerB = await getGhgStatementSubmissionForFacility(orgCtx, {
      facilityId: facilityB,
      externalId: remote.id,
    });
    expect(ledgerA?.localEntityId).toBe(statementA.id);
    expect(ledgerB?.localEntityId).toBe(statementB.id);
    expect(ledgerA?.id).not.toBe(ledgerB?.id);
    // A's row survived untouched — importing under B is not a re-home.
    expect(
      (await listGhgStatementsForFacility(orgCtx, facilityA)).map(
        (row) => row.id,
      ),
    ).toEqual([statementA.id]);
  });

  it("counts a statement it declines to import instead of dropping it silently", async () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const externalProjectId = `prj_ggs_sk_${runId}`;
    const owner = await createFacility(TEST_ORG_ID, "Owner");
    const neighbour = await createFacility(TEST_ORG_ID, "Neighbour");
    await db.insert(certifierProjects).values([
      {
        organizationId: TEST_ORG_ID,
        facilityId: owner,
        provider: "isometric" as const,
        externalProjectId,
      },
      {
        organizationId: TEST_ORG_ID,
        facilityId: neighbour,
        provider: "isometric" as const,
        externalProjectId,
      },
    ]);
    const [removal] = await db
      .insert(certifierRemovals)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: owner,
        completedOn: IN_WINDOW_COMPLETED_ON,
      })
      .returning({ id: certifierRemovals.id });
    const externalRemovalId = `rmv_ggs_sk_${runId}`;
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
    vi.mocked(authServer.getUser).mockResolvedValue({
      id: `test-user-ggs-sk-${runId}`,
      email: `ggs-sk-${runId}@example.com`,
      name: "Identity Tester",
      emailVerified: true,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(authServer.requireOrgContext).mockResolvedValue(
      makeTestOrgContext(`test-user-ggs-sk-${runId}`),
    );
    registry.seedGhgStatement({
      projectId: externalProjectId,
      endOn: REPORTING_PERIOD_END,
      ghgEntryIds: [externalRemovalId],
    });

    const result = await reconcileGhgStatementsFromRegistry(neighbour);

    expect(result).toMatchObject({
      success: true,
      data: { reconciledCount: 0, warningCount: 1, skippedCount: 1 },
    });
  });
});
