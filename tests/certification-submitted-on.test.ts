import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Keep withAction and all persistence real; replace only session resolution.
vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return { ...actual, requireOrgContext: vi.fn() };
});

import { db } from "@/db";
import * as certification from "@/data-access/certification";
import { organizations } from "@/db/schema/auth";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { loadGhgStatementsForFacility } from "@/fn/certification/ghg-statements";
import { loadRemovalsForFacility } from "@/fn/certification/removals-hub";
import * as authServer from "@/lib/auth/server";
import { REGISTRY_DISCOVERY_SOURCE } from "@/lib/certification/submission-source";
import { submittedOnState } from "@/lib/certification/submitted-on";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
  TEST_SITE_POSITION,
} from "./helpers/test-org";

const INITIAL_VERSION = 1;
const LATEST_VERSION = 2;
// The highest version deliberately has the earlier timestamp: latest means
// ledger version, rather than max(submittedAt) or insertion order.
const FIRST_SUBMITTED_AT = new Date("2026-03-20T12:00:00.000Z");
const LATEST_SUBMITTED_AT = new Date("2026-03-15T10:30:00.000Z");
const REPORTING_PERIOD_END = "2026-03-31";
const DRAFT_REPORTING_PERIOD_END = "2026-02-28";
const EMPTY_REPORTING_PERIOD_END = "2026-01-31";
const OTHER_ORG_ID = `org_submitted_on_${crypto.randomUUID()}`;
const createdFacilityIds: string[] = [];
const createdEntityIds: string[] = [];

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(organizations).values({
    id: OTHER_ORG_ID,
    name: "Submitted on isolation fixture",
    slug: OTHER_ORG_ID,
  });
});

beforeEach(() => {
  vi.mocked(authServer.requireOrgContext).mockResolvedValue(makeTestOrgContext());
});

afterAll(async () => {
  if (createdEntityIds.length > 0) {
    await db.delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, createdEntityIds));
  }
  if (createdFacilityIds.length > 0) {
    await db.delete(certifierRemovals)
      .where(inArray(certifierRemovals.facilityId, createdFacilityIds));
    await db.delete(certifierGhgStatements)
      .where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
    await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
  }
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG_ID));
});

async function createFacility(organizationId = TEST_ORG_ID) {
  const runId = crypto.randomUUID();
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION,
    timezone: "UTC",
    organizationId,
    name: `Submitted on fixture ${runId}`,
    code: `FAC-SUB-${runId}`,
  }).returning();
  createdFacilityIds.push(facility.id);
  return facility;
}

async function createRemoval(facility: typeof facilities.$inferSelect) {
  const [removal] = await insertRemovalFixture(db, {
    organizationId: facility.organizationId,
    facilityId: facility.id,
  });
  createdEntityIds.push(removal.id);
  return removal;
}

async function createStatement(
  facility: typeof facilities.$inferSelect,
  reportingPeriodEndOn = REPORTING_PERIOD_END,
) {
  const [statement] = await db.insert(certifierGhgStatements).values({
    organizationId: facility.organizationId,
    facilityId: facility.id,
    reportingPeriodEndOn,
  }).returning();
  createdEntityIds.push(statement.id);
  return statement;
}

async function insertSubmission(
  entity: { id: string; organizationId: string },
  localEntityType: typeof REMOVAL_ENTITY_TYPE | typeof GHG_STATEMENT_ENTITY_TYPE,
  overrides: Partial<typeof certificationSubmissions.$inferInsert> = {},
) {
  const [submission] = await db.insert(certificationSubmissions).values({
    organizationId: entity.organizationId,
    provider: ISOMETRIC_PROVIDER,
    localEntityType,
    submissionType: localEntityType === REMOVAL_ENTITY_TYPE
      ? REMOVAL_SUBMISSION_TYPE
      : GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityId: entity.id,
    version: INITIAL_VERSION,
    status: "draft",
    ...overrides,
  }).returning();
  return submission;
}

describe("submitted on list payloads (real DB)", () => {
  it("loads missing, draft and latest submitted Removals with one batched lookup", async () => {
    const facility = await createFacility();
    const empty = await createRemoval(facility);
    const draft = await createRemoval(facility);
    const submitted = await createRemoval(facility);
    await insertSubmission(draft, REMOVAL_ENTITY_TYPE);
    // Insert latest first to rule out relying on insertion order.
    const latest = await insertSubmission(submitted, REMOVAL_ENTITY_TYPE, {
      version: LATEST_VERSION,
      status: "submitted",
      submittedAt: LATEST_SUBMITTED_AT,
      payloadSnapshot: { semantic: { source: "operator" } },
    });
    await insertSubmission(submitted, REMOVAL_ENTITY_TYPE, {
      status: "superseded",
      submittedAt: FIRST_SUBMITTED_AT,
    });
    const lookup = vi.spyOn(certification, "getLatestSubmissionsForEntities");

    const result = await loadRemovalsForFacility(facility.id);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const entries = new Map(result.data.removals.map((entry) => [entry.removal.id, entry]));
    expect([...entries.keys()].sort()).toEqual([empty.id, draft.id, submitted.id].sort());
    expect(entries.get(empty.id)?.latestSubmission).toBeNull();
    expect(submittedOnState(entries.get(empty.id)!.latestSubmission)).toEqual({ kind: "never" });
    expect(entries.get(draft.id)?.latestSubmission?.status).toBe("draft");
    expect(submittedOnState(entries.get(draft.id)!.latestSubmission)).toEqual({ kind: "never" });
    expect(entries.get(submitted.id)?.latestSubmission).toEqual(latest);
    expect(submittedOnState(entries.get(submitted.id)!.latestSubmission)).toEqual({
      kind: "submitted", at: LATEST_SUBMITTED_AT,
    });
    expect(lookup).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityIds: expect.arrayContaining([empty.id, draft.id, submitted.id]),
    });
  });

  it("uses a latest draft even when an older Removal version was submitted", async () => {
    const facility = await createFacility();
    const removal = await createRemoval(facility);
    await insertSubmission(removal, REMOVAL_ENTITY_TYPE, {
      status: "submitted", submittedAt: FIRST_SUBMITTED_AT,
    });
    const latest = await insertSubmission(removal, REMOVAL_ENTITY_TYPE, {
      version: LATEST_VERSION,
    });

    const result = await loadRemovalsForFacility(facility.id);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const [entry] = result.data.removals;
    expect(entry.latestSubmission).toEqual(latest);
    expect(submittedOnState(entry.latestSubmission)).toEqual({ kind: "never" });
    expect(entry.hasFinalizedSubmission).toBe(true);
  });

  it("loads never-submitted and latest submitted GHG Statements", async () => {
    const facility = await createFacility();
    const empty = await createStatement(facility, EMPTY_REPORTING_PERIOD_END);
    const draft = await createStatement(facility, DRAFT_REPORTING_PERIOD_END);
    const submitted = await createStatement(facility);
    await insertSubmission(draft, GHG_STATEMENT_ENTITY_TYPE);
    await insertSubmission(submitted, GHG_STATEMENT_ENTITY_TYPE, {
      status: "superseded", submittedAt: FIRST_SUBMITTED_AT,
    });
    const latest = await insertSubmission(submitted, GHG_STATEMENT_ENTITY_TYPE, {
      version: LATEST_VERSION,
      status: "submitted",
      submittedAt: LATEST_SUBMITTED_AT,
    });

    const result = await loadGhgStatementsForFacility(facility.id);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const entries = new Map(result.data.map((entry) => [entry.statement.id, entry]));
    expect([...entries.keys()].sort()).toEqual([empty.id, draft.id, submitted.id].sort());
    expect(entries.get(empty.id)?.latestSubmission).toBeNull();
    expect(submittedOnState(entries.get(empty.id)!.latestSubmission)).toEqual({ kind: "never" });
    expect(entries.get(draft.id)?.latestSubmission?.status).toBe("draft");
    expect(submittedOnState(entries.get(draft.id)!.latestSubmission)).toEqual({ kind: "never" });
    expect(entries.get(submitted.id)?.latestSubmission).toEqual(latest);
    expect(submittedOnState(entries.get(submitted.id)!.latestSubmission)).toEqual({
      kind: "submitted", at: LATEST_SUBMITTED_AT,
    });
  });

  it("recognizes a registry-discovery snapshot despite its submittedAt", async () => {
    const facility = await createFacility();
    const statement = await createStatement(facility);
    // Same ledger shape written by reconcileRegistryGhgStatement: the
    // submitted timestamp records discovery, not an operator submission.
    const discovered = await insertSubmission(statement, GHG_STATEMENT_ENTITY_TYPE, {
      status: "submitted",
      submittedAt: LATEST_SUBMITTED_AT,
      payloadSnapshot: { semantic: { source: REGISTRY_DISCOVERY_SOURCE } },
    });

    const result = await loadGhgStatementsForFacility(facility.id);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data[0].latestSubmission).toEqual(discovered);
    expect(submittedOnState(result.data[0].latestSubmission)).toEqual({ kind: "registryDiscovered" });
  });

  it("excludes another organization's entities and refuses its facility", async () => {
    const ownFacility = await createFacility();
    const otherFacility = await createFacility(OTHER_ORG_ID);
    const ownRemoval = await createRemoval(ownFacility);
    const otherRemoval = await createRemoval(otherFacility);
    const ownStatement = await createStatement(ownFacility);
    const otherStatement = await createStatement(otherFacility);
    for (const removal of [ownRemoval, otherRemoval]) {
      await insertSubmission(removal, REMOVAL_ENTITY_TYPE, {
        status: "submitted", submittedAt: LATEST_SUBMITTED_AT,
      });
    }
    for (const statement of [ownStatement, otherStatement]) {
      await insertSubmission(statement, GHG_STATEMENT_ENTITY_TYPE, {
        status: "submitted", submittedAt: LATEST_SUBMITTED_AT,
      });
    }

    const removals = await loadRemovalsForFacility(ownFacility.id);
    const statements = await loadGhgStatementsForFacility(ownFacility.id);
    expect(removals.success).toBe(true);
    expect(statements.success).toBe(true);
    if (!removals.success) throw new Error(removals.error);
    if (!statements.success) throw new Error(statements.error);
    expect(removals.data.removals.map((entry) => entry.removal.id)).toEqual([ownRemoval.id]);
    expect(statements.data.map((entry) => entry.statement.id)).toEqual([ownStatement.id]);
    expect(removals.data.removals[0].latestSubmission?.organizationId).toBe(TEST_ORG_ID);
    expect(statements.data[0].latestSubmission?.organizationId).toBe(TEST_ORG_ID);
    expect((await loadRemovalsForFacility(otherFacility.id)).success).toBe(false);
    expect((await loadGhgStatementsForFacility(otherFacility.id)).success).toBe(false);

    vi.mocked(authServer.requireOrgContext).mockResolvedValue({
      ...makeTestOrgContext(), organizationId: OTHER_ORG_ID,
    });
    const otherRemovals = await loadRemovalsForFacility(otherFacility.id);
    const otherStatements = await loadGhgStatementsForFacility(otherFacility.id);
    expect(otherRemovals.success).toBe(true);
    expect(otherStatements.success).toBe(true);
    if (!otherRemovals.success) throw new Error(otherRemovals.error);
    if (!otherStatements.success) throw new Error(otherStatements.error);
    expect(otherRemovals.data.removals.map((entry) => entry.removal.id)).toEqual([otherRemoval.id]);
    expect(otherStatements.data.map((entry) => entry.statement.id)).toEqual([otherStatement.id]);
    expect(otherRemovals.data.removals[0].latestSubmission?.organizationId).toBe(OTHER_ORG_ID);
    expect(otherStatements.data[0].latestSubmission?.organizationId).toBe(OTHER_ORG_ID);
  });
});
