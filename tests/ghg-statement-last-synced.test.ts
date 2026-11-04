import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

// Keep action/authz and persistence real; replace the session and registry transport.
vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return { ...actual, requireOrgContext: vi.fn() };
});
vi.mock("@/data-access/certifier-credentials", async (importOriginal) =>
  (await import("./fixtures/fake-registry")).fakeCredentialsModule(importOriginal),
);
vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});

import { db } from "@/db";
import { getSubmissionById } from "@/data-access/certification";
import * as syncEvents from "@/data-access/certifier-sync-events";
import * as submissions from "@/data-access/certification-submissions";
import { organizations, users } from "@/db/schema/auth";
import { activityEvents } from "@/db/schema/activity";
import { documents } from "@/db/schema/documentation";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import {
  createGhgStatementDraft,
  loadGhgStatementsForFacility,
  loadGhgStatementState,
  refreshGhgStatementStatus,
  submitGhgStatementToVerifier,
} from "@/fn/certification/ghg-statements";
import {
  GHG_STATEMENT_SYNC_OPERATION,
  ghgStatementSyncEvent,
} from "@/fn/certification/ghg-statement-last-synced";
import {
  loadRegistryGhgStatements,
  reconcileGhgStatementsFromRegistry,
} from "@/fn/certification/ghg-statement-sync";
import * as authServer from "@/lib/auth/server";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "@/lib/isometric/utils/constants";
import { installFakeRegistry, type FakeIsometricRegistry } from "./fixtures/fake-registry";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

const INITIAL_VERSION = 1;
const NEWER_VERSION = 2;
const FIRST_SYNC_AT = new Date("2026-03-15T10:30:00.000Z");
const LATEST_SYNC_AT = new Date("2026-03-20T12:00:00.000Z");
const OTHER_SYNC_AT = new Date("2026-04-01T12:00:00.000Z");
const PERIOD_END = "2026-03-31";
const EARLIER_PERIOD_END = "2026-02-28";
const REPORT_URL = "https://example.com/ghg-report.pdf";
const OTHER_ORG_ID = `org_last_synced_${crypto.randomUUID()}`;
const createdFacilityIds: string[] = [];
const createdUserIds: string[] = [];
let registry: FakeIsometricRegistry;

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(organizations).values({
    id: OTHER_ORG_ID,
    name: "Last synced isolation fixture",
    slug: OTHER_ORG_ID,
  });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  registry = installFakeRegistry();
  // Separate user ids keep create/submit rate limits independent across tests.
  const userId = `last-synced-${crypto.randomUUID()}`;
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, name: "Last synced fixture" });
  createdUserIds.push(userId);
  vi.mocked(authServer.requireOrgContext).mockResolvedValue(makeTestOrgContext(userId));
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (createdFacilityIds.length > 0) {
    const statements = await db.select({ id: certifierGhgStatements.id })
      .from(certifierGhgStatements)
      .where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
    const statementIds = statements.map((statement) => statement.id);
    if (statementIds.length > 0) {
      const ledger = await db.select({ id: certificationSubmissions.id }).from(certificationSubmissions)
        .where(inArray(certificationSubmissions.localEntityId, statementIds));
      const activityEntityIds = [...statementIds];
      if (ledger.length > 0) {
        const reportDocuments = await db.select({ id: documents.id }).from(documents)
          .where(inArray(documents.entityId, ledger.map((row) => row.id)));
        activityEntityIds.push(...reportDocuments.map((document) => document.id));
        await db.delete(documents).where(inArray(documents.entityId, ledger.map((row) => row.id)));
      }
      await db.delete(activityEvents).where(inArray(activityEvents.entityId, activityEntityIds));
      await db.delete(certifierSyncEvents).where(inArray(certifierSyncEvents.entityId, statementIds));
      await db.delete(certificationSubmissions)
        .where(inArray(certificationSubmissions.localEntityId, statementIds));
      await db.delete(certifierGhgStatements).where(inArray(certifierGhgStatements.id, statementIds));
    }
    await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, createdFacilityIds));
    await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
  }
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG_ID));
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

async function createFacility(organizationId = TEST_ORG_ID) {
  const runId = crypto.randomUUID();
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION,
    timezone: "UTC",
    organizationId,
    name: `Last synced fixture ${runId}`,
    code: `FAC-SYNC-${runId}`,
  }).returning();
  createdFacilityIds.push(facility.id);
  return facility;
}

async function linkProject(facility: typeof facilities.$inferSelect, externalProjectId = `prj_${facility.id}`) {
  await db.insert(certifierProjects).values({
    organizationId: facility.organizationId,
    facilityId: facility.id,
    provider: ISOMETRIC_PROVIDER,
    externalFacilityId: `fcl_${facility.id}`,
    externalProjectId,
  });
  return externalProjectId;
}

async function createStatement(facility: typeof facilities.$inferSelect, reportingPeriodEndOn = PERIOD_END) {
  const [statement] = await db.insert(certifierGhgStatements).values({
    organizationId: facility.organizationId,
    facilityId: facility.id,
    reportingPeriodEndOn,
  }).returning();
  return statement;
}

async function insertSubmission(
  statement: typeof certifierGhgStatements.$inferSelect,
  overrides: Partial<typeof certificationSubmissions.$inferInsert> = {},
) {
  const [submission] = await db.insert(certificationSubmissions).values({
    organizationId: statement.organizationId,
    provider: ISOMETRIC_PROVIDER,
    localEntityType: GHG_STATEMENT_ENTITY_TYPE,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityId: statement.id,
    version: INITIAL_VERSION,
    status: "submitted",
    ...overrides,
  }).returning();
  return submission;
}

async function insertEvent(entityId: string, overrides: Partial<syncEvents.AppendSyncEventInput> = {}) {
  await syncEvents.appendSyncEvent(makeTestOrgContext(), {
    ...ghgStatementSyncEvent(entityId),
    attemptedAt: FIRST_SYNC_AT,
    ...overrides,
  });
}

async function listItems(facilityId: string) {
  const result = await loadGhgStatementsForFacility(facilityId);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function succeededSyncEvents(facilityId: string) {
  const items = await listItems(facilityId);
  if (items.length === 0) return [];
  return db.select().from(certifierSyncEvents).where(and(
    eq(certifierSyncEvents.organizationId, TEST_ORG_ID),
    eq(certifierSyncEvents.provider, ISOMETRIC_PROVIDER),
    eq(certifierSyncEvents.entityType, GHG_STATEMENT_ENTITY_TYPE),
    eq(certifierSyncEvents.operation, GHG_STATEMENT_SYNC_OPERATION),
    eq(certifierSyncEvents.status, "succeeded"),
    inArray(certifierSyncEvents.entityId, items.map((item) => item.statement.id)),
  ));
}

describe("GHG Statement last synced list payload (real DB)", () => {
  it("returns null for a statement that has never synced", async () => {
    const facility = await createFacility();
    await createStatement(facility);
    expect((await listItems(facility.id))[0].lastSyncedAt).toBeNull();
  });

  it("returns the successful sync time as a Date", async () => {
    const facility = await createFacility();
    const statement = await createStatement(facility);
    await insertEvent(statement.id);
    expect((await listItems(facility.id))[0].lastSyncedAt).toEqual(FIRST_SYNC_AT);
  });

  it("uses max(attemptedAt), even when the newest sync was inserted first", async () => {
    const facility = await createFacility();
    const statement = await createStatement(facility);
    await insertEvent(statement.id, { attemptedAt: LATEST_SYNC_AT });
    await insertEvent(statement.id);
    expect((await listItems(facility.id))[0].lastSyncedAt).toEqual(LATEST_SYNC_AT);
  });

  it("ignores failed syncs, including a newer failure after a success", async () => {
    const facility = await createFacility();
    const failedOnly = await createStatement(facility);
    const succeeded = await createStatement(facility, EARLIER_PERIOD_END);
    await insertEvent(failedOnly.id, { status: "failed" });
    await insertEvent(succeeded.id);
    await insertEvent(succeeded.id, { status: "failed", attemptedAt: LATEST_SYNC_AT });
    const items = new Map((await listItems(facility.id)).map((item) => [item.statement.id, item]));
    expect(items.get(failedOnly.id)?.lastSyncedAt).toBeNull();
    expect(items.get(succeeded.id)?.lastSyncedAt).toEqual(FIRST_SYNC_AT);
  });

  it("ignores other operations and entity types", async () => {
    const facility = await createFacility();
    const statement = await createStatement(facility);
    await insertEvent(statement.id, { operation: "ghg_statement:submit" });
    await insertEvent(statement.id, { entityType: "removal" });
    expect((await listItems(facility.id))[0].lastSyncedAt).toBeNull();
  });

  it("batches the event lookup once for all statements", async () => {
    const facility = await createFacility();
    const first = await createStatement(facility);
    const second = await createStatement(facility, EARLIER_PERIOD_END);
    await insertEvent(first.id);
    await insertEvent(second.id, { attemptedAt: LATEST_SYNC_AT });
    const lookup = vi.spyOn(syncEvents, "getLastSyncedAtForEntities");
    const items = await listItems(facility.id);
    expect(items).toHaveLength(2);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ organizationId: TEST_ORG_ID }),
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: GHG_STATEMENT_ENTITY_TYPE,
        operation: GHG_STATEMENT_SYNC_OPERATION,
        entityIds: expect.arrayContaining([first.id, second.id]),
      },
    );
    const atById = new Map(items.map((item) => [item.statement.id, item.lastSyncedAt]));
    expect(atById.get(first.id)).toEqual(FIRST_SYNC_AT);
    expect(atById.get(second.id)).toEqual(LATEST_SYNC_AT);
  });

  it("does not query for empty ids and still requires org scope", async () => {
    const select = vi.spyOn(db, "select");
    const key = {
      provider: ISOMETRIC_PROVIDER,
      entityType: GHG_STATEMENT_ENTITY_TYPE,
      operation: GHG_STATEMENT_SYNC_OPERATION,
      entityIds: [],
    };
    expect(await syncEvents.getLastSyncedAtForEntities(makeTestOrgContext(), key)).toEqual(new Map());
    await expect(syncEvents.getLastSyncedAtForEntities({
      ...makeTestOrgContext(), organizationId: "",
    }, key)).rejects.toThrow();
    expect(select).not.toHaveBeenCalled();
  });

  it("isolates other organizations' events, including events using this org's statement id", async () => {
    const ownFacility = await createFacility();
    const otherFacility = await createFacility(OTHER_ORG_ID);
    const own = await createStatement(ownFacility);
    const other = await createStatement(otherFacility);
    await insertEvent(own.id);
    const otherCtx = { ...makeTestOrgContext(), organizationId: OTHER_ORG_ID };
    for (const entityId of [own.id, other.id]) {
      await syncEvents.appendSyncEvent(otherCtx, {
        ...ghgStatementSyncEvent(entityId), attemptedAt: OTHER_SYNC_AT,
      });
    }
    const items = await listItems(ownFacility.id);
    expect(items.map((item) => item.statement.id)).toEqual([own.id]);
    expect(items[0].lastSyncedAt).toEqual(FIRST_SYNC_AT);
    expect((await loadGhgStatementsForFacility(otherFacility.id)).success).toBe(false);
    vi.mocked(authServer.requireOrgContext).mockResolvedValue(otherCtx);
    const otherItems = await listItems(otherFacility.id);
    expect(otherItems.map((item) => item.statement.id)).toEqual([other.id]);
    expect(otherItems[0].lastSyncedAt).toEqual(OTHER_SYNC_AT);
  });
});

describe("successful registry reconciliation records syncs (real DB, fake registry)", () => {
  it("writes exactly one success per reconciled statement on each sweep", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    registry.seedGhgStatement({ projectId, endOn: EARLIER_PERIOD_END });
    for (const expectedCount of [1, 2]) {
      const result = await reconcileGhgStatementsFromRegistry(facility.id);
      expect(result).toMatchObject({ success: true, data: { reconciledCount: 2, skippedCount: 0 } });
      const events = await succeededSyncEvents(facility.id);
      const items = await listItems(facility.id);
      expect(items).toHaveLength(2);
      for (const item of items) {
        const ownEvents = events.filter((event) => event.entityId === item.statement.id);
        expect(ownEvents).toHaveLength(expectedCount);
        expect(item.lastSyncedAt).toEqual(
          new Date(Math.max(...ownEvents.map((event) => event.attemptedAt.getTime()))),
        );
      }
    }
  });

  it("writes no event for statements skipped because ownership is ambiguous", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const otherFacility = await createFacility();
    await linkProject(otherFacility, projectId);
    // This existing mirror belongs to the requested facility; the second remote
    // has no membership to establish ownership within the shared project.
    const remote = registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    registry.seedGhgStatement({ projectId, endOn: EARLIER_PERIOD_END });
    const statement = await createStatement(facility);
    await insertSubmission(statement, { externalId: remote.id });
    expect(await reconcileGhgStatementsFromRegistry(facility.id)).toMatchObject({
      success: true, data: { reconciledCount: 1, skippedCount: 1 },
    });
    const events = await succeededSyncEvents(facility.id);
    expect(events.map((event) => event.entityId)).toEqual([statement.id]);
  });

  it("writes no event when an operator create makes the sweep skip", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    const statement = await createStatement(facility);
    await insertSubmission(statement, { status: "draft", lockedAt: new Date() });
    expect(await reconcileGhgStatementsFromRegistry(facility.id)).toMatchObject({
      success: true, data: { reconciledCount: 0, skippedCount: 1 },
    });
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
  });

  it("writes no event for the concurrent-reconciliation warning-only return", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    // Force the narrow claim race; transport and every other DB operation stay real.
    vi.spyOn(submissions, "claimSubmissionDraft").mockResolvedValueOnce({
      kind: "blocked", reason: "in-flight",
    });
    const result = await reconcileGhgStatementsFromRegistry(facility.id);
    expect(result).toMatchObject({ success: true, data: { warningCount: 1 } });
    expect(await listItems(facility.id)).toHaveLength(1);
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
  });

  it("discards staged successes if a later statement fails and rolls the sweep back", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const first = registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    registry.seedGhgStatement({ projectId, endOn: EARLIER_PERIOD_END });
    const statement = await createStatement(facility);
    await insertSubmission(statement, { externalId: first.id });
    vi.spyOn(submissions, "claimSubmissionDraft").mockRejectedValueOnce(new Error("reconcile failed"));
    expect((await reconcileGhgStatementsFromRegistry(facility.id)).success).toBe(false);
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
  });

  it("records refresh after mirroring and rejects superseded versions without an event", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({ projectId, endOn: PERIOD_END, status: "VERIFIED" });
    const statement = await createStatement(facility);
    const stale = await insertSubmission(statement, { externalId: `${remote.id}_v1`, status: "superseded" });
    const latest = await insertSubmission(statement, { externalId: remote.id, version: NEWER_VERSION });
    expect((await refreshGhgStatementStatus(stale.id)).success).toBe(false);
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
    expect((await refreshGhgStatementStatus(latest.id)).success).toBe(true);
    expect(await succeededSyncEvents(facility.id)).toHaveLength(1);
    expect((await getSubmissionById(makeTestOrgContext(), latest.id))?.status).toBe("accepted");
  });

  it("writes no event for a failed registry refresh", async () => {
    const facility = await createFacility();
    const statement = await createStatement(facility);
    const submission = await insertSubmission(statement, { externalId: "ggs_missing" });
    expect((await refreshGhgStatementStatus(submission.id)).success).toBe(false);
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
  });

  it("records finalization and the by-id reconcile on repeat create once each", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    const input = { facilityId: facility.id, reportingPeriodEndOn: PERIOD_END };
    expect((await createGhgStatementDraft(input)).success).toBe(true);
    expect(await succeededSyncEvents(facility.id)).toHaveLength(1);
    expect((await createGhgStatementDraft(input)).success).toBe(true);
    expect(await succeededSyncEvents(facility.id)).toHaveLength(2);
  });

  it("does not count finalization's DRAFT fallback when its registry read fails", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    registry.failNext(`GET /ghg_statements/${remote.id}`, "reject-before-commit");
    expect((await createGhgStatementDraft({
      facilityId: facility.id, reportingPeriodEndOn: PERIOD_END,
    })).success).toBe(true);
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
    expect((await listItems(facility.id))[0].lastSyncedAt).toBeNull();
  });

  it("keeps a successful refresh committed when the best-effort event insert fails", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({ projectId, endOn: PERIOD_END, status: "VERIFIED" });
    const statement = await createStatement(facility);
    const submission = await insertSubmission(statement, { externalId: remote.id });
    const append = vi.spyOn(syncEvents, "appendSyncEvent").mockRejectedValueOnce(new Error("audit unavailable"));
    expect((await refreshGhgStatementStatus(submission.id)).success).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
    expect((await getSubmissionById(makeTestOrgContext(), submission.id))?.status).toBe("accepted");
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
  });

  it.each(["normal", "drop-after-commit"] as const)("records one sync for %s verifier submission", async (mode) => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({
      projectId, endOn: PERIOD_END, ghgEntryIds: ["rmv_registry_only"],
    });
    const statement = await createStatement(facility);
    await insertSubmission(statement, { externalId: remote.id, metadata: { remoteStatus: "DRAFT" } });
    if (mode === "drop-after-commit") {
      // The fake normally shares mutable records. Capture a wire-like snapshot
      // so the pre-submit fingerprint cannot mutate with the provider write.
      const before = registry.deferNextResponse(`GET /ghg_statements/${remote.id}`);
      before.release();
      registry.failNext(`POST /ghg_statements/${remote.id}/submit`, mode);
    }
    expect((await submitGhgStatementToVerifier(statement.id, { externalReportUrl: REPORT_URL })).success).toBe(true);
    expect(await succeededSyncEvents(facility.id)).toHaveLength(1);
  });

  it("records one sync when submit recovers an already-applied verifier submission", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({
      projectId, endOn: PERIOD_END, status: "AWAITING_VERIFICATION", ghgEntryIds: ["rmv_registry_only"],
    });
    remote.ghg_statement_report_url = REPORT_URL;
    const statement = await createStatement(facility);
    await insertSubmission(statement, { externalId: remote.id, metadata: { remoteStatus: "DRAFT" } });
    expect((await submitGhgStatementToVerifier(statement.id, { externalReportUrl: REPORT_URL })).success).toBe(true);
    expect(registry.requestCount("POST", `/ghg_statements/${remote.id}/submit`)).toBe(0);
    expect(await succeededSyncEvents(facility.id)).toHaveLength(1);
  });

  it("keeps a failed submit row in the submission history after more than ten syncs", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    const statement = await createStatement(facility);
    await insertSubmission(statement, { externalId: remote.id });
    await insertEvent(statement.id, {
      operation: "ghg_statement:submit",
      status: "failed",
      errorMessage: "verifier refused",
      attemptedAt: FIRST_SYNC_AT,
    });
    const syncCount = 12;
    for (let i = 0; i < syncCount; i += 1) {
      await insertEvent(statement.id, { attemptedAt: new Date(LATEST_SYNC_AT.getTime() + i * 60_000) });
    }

    const result = await loadGhgStatementState(statement.id);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const operations = result.data.recentSyncEvents.map((event) => event.operation);
    expect(operations).toContain("ghg_statement:submit");
    expect(operations).not.toContain(GHG_STATEMENT_SYNC_OPERATION);
  });

  it("does not record syncs for read-only state and registry list views", async () => {
    const facility = await createFacility();
    const projectId = await linkProject(facility);
    const remote = registry.seedGhgStatement({ projectId, endOn: PERIOD_END });
    const statement = await createStatement(facility);
    await insertSubmission(statement, { externalId: remote.id });
    expect((await loadGhgStatementState(statement.id)).success).toBe(true);
    expect((await loadRegistryGhgStatements(facility.id)).success).toBe(true);
    expect(await succeededSyncEvents(facility.id)).toEqual([]);
    expect((await listItems(facility.id))[0].lastSyncedAt).toBeNull();
  });
});
