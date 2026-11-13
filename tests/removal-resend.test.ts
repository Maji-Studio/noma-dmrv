/** Real PostgreSQL coverage. Do not run in a sandbox without a test database. */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierGhgStatements, certifierProjects, certifierRemovals, certifierSyncEvents } from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { activityEvents } from "@/db/schema/activity";
import { retireMissingRemovalSubmission, removalResendKey } from "@/data-access/removal-resend";
import { claimSubmissionDraft, getLatestSubmission } from "@/data-access/certification-submissions";
import { REMOVAL_RESEND_OPERATION } from "@/lib/certification/removal-registry-presence";
import { REMOVAL_SUBMISSION_CLAIM_POLICY } from "@/lib/isometric/utils/submission-claim";
import { isSentRemoval } from "@/lib/record-lock";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";
import { insertRemovalFixture } from "./helpers/removal-fixture";

const ctx = makeTestOrgContext();
const removalIds: string[] = [];
const facilityIds: string[] = [];
beforeAll(() => ensureTestOrg(db));
afterAll(async () => {
  if (!removalIds.length) return;
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, TEST_ORG_ID), inArray(activityEvents.entityId, removalIds)));
  await db.delete(certifierSyncEvents).where(inArray(certifierSyncEvents.entityId, removalIds));
  await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.localEntityId, removalIds));
  await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, removalIds));
  await db.delete(certifierGhgStatements).where(inArray(certifierGhgStatements.facilityId, facilityIds));
  await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, facilityIds));
  await db.delete(facilities).where(inArray(facilities.id, facilityIds));
});

async function fixture() {
  const tag = crypto.randomUUID();
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, timezone: "UTC", organizationId: TEST_ORG_ID,
    name: `Resend ${tag}`, code: `RS-${tag}`, durabilityOption: "200_year" }).returning();
  facilityIds.push(facility.id);
  const externalProjectId = `prj_${tag}`;
  await db.insert(certifierProjects).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, provider: "isometric", externalFacilityId: `fcl_${tag}`, externalProjectId });
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: TEST_ORG_ID, facilityId: facility.id,
    provider: "isometric", reportingPeriodEndOn: "2026-12-31" }).returning();
  const [removal] = await insertRemovalFixture(db, { organizationId: TEST_ORG_ID, facilityId: facility.id, provider: "isometric", ghgStatementId: statement.id });
  removalIds.push(removal.id);
  const key = removalResendKey(removal.id);
  const [submission] = await db.insert(certificationSubmissions).values({ ...key, organizationId: TEST_ORG_ID,
    status: "submitted", version: 1, externalId: `rmv_${tag}`, submittedAt: new Date(), lockedAt: null,
    payloadHash: "same", payloadSnapshot: { semantic: { inputs: [] } }, metadata: { retained: true } }).returning();
  return { input: { facilityId: facility.id, removalId: removal.id }, key, submission, externalProjectId };
}

type LedgerRow = { id: string; status: string; externalId: string | null; submittedAt: Date | null };
const toLock = (row: LedgerRow) => ({ id: row.id, status: row.status, externalId: row.externalId, submittedAt: row.submittedAt?.toISOString() ?? null });

it("atomically retires, audits, unlinks, stays Sent and claims today's v2; concurrent retries are no-ops", async () => {
  const f = await fixture();
  const check = vi.fn(async () => "missing" as const);
  expect(isSentRemoval({ id: f.input.removalId, statements: [], submissions: [toLock(f.submission)] })).toBe(true);
  const results = await Promise.all([
    retireMissingRemovalSubmission(ctx, f.input, check), retireMissingRemovalSubmission(ctx, f.input, check),
  ]);
  expect(results.filter(result => result.prepared)).toHaveLength(1);
  expect(check).toHaveBeenCalledExactlyOnceWith(f.submission.externalId);
  const retired = await getLatestSubmission(ctx, f.key);
  expect(retired).toMatchObject({ status: "superseded", externalId: f.submission.externalId, submittedAt: f.submission.submittedAt,
    payloadSnapshot: f.submission.payloadSnapshot, metadata: { retained: true, registryMissingExternalId: f.submission.externalId,
      registryMissingConfirmedAt: expect.any(String) } });
  expect(isSentRemoval({ id: f.input.removalId, statements: [], submissions: [toLock(retired!)] })).toBe(true);
  const [removal] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, f.input.removalId));
  expect(removal.ghgStatementId).toBeNull();
  const events = await db.select().from(certifierSyncEvents).where(and(eq(certifierSyncEvents.entityId, f.input.removalId), eq(certifierSyncEvents.operation, REMOVAL_RESEND_OPERATION)));
  expect(events).toHaveLength(1);
  const claimed = await claimSubmissionDraft(ctx, { key: f.key,
    guard: { facilityId: f.input.facilityId, provider: "isometric", expectedExternalProjectId: f.externalProjectId },
    policy: REMOVAL_SUBMISSION_CLAIM_POLICY, tentativeInputs: { today: 42 }, hashOf: () => "same",
    buildSnapshot: ({ inputs }) => ({ payloadSnapshot: inputs }),
  });
  expect(claimed).toMatchObject({ kind: "claimed", resumed: false, reason: "after-superseded", row: { version: 2, payloadSnapshot: { today: 42 } } });
  if (claimed.kind !== "claimed") throw new Error("Expected v2 claim");
  expect(isSentRemoval({ id: f.input.removalId, statements: [], submissions: [toLock(retired!), toLock(claimed.row)] })).toBe(true);
});

it.each(["present", "unknown"] as const)("refuses %s without changing the ledger or statement link", async presence => {
  const f = await fixture();
  await expect(retireMissingRemovalSubmission(ctx, f.input, async () => presence)).rejects.toThrow();
  expect(await getLatestSubmission(ctx, f.key)).toEqual(f.submission);
  const [removal] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, f.input.removalId));
  expect(removal.ghgStatementId).not.toBeNull();
  expect(await db.select().from(certifierSyncEvents).where(eq(certifierSyncEvents.entityId, f.input.removalId))).toHaveLength(0);
});

it("rejects wrong organization, facility and non-admin access before registry I/O", async () => {
  const f = await fixture();
  const check = vi.fn(async () => "missing" as const);
  await expect(retireMissingRemovalSubmission({ ...ctx, organizationId: "other" }, f.input, check)).rejects.toThrow();
  await expect(retireMissingRemovalSubmission(ctx, { ...f.input, facilityId: crypto.randomUUID() }, check)).rejects.toThrow();
  await expect(retireMissingRemovalSubmission({ ...ctx, orgRole: "member" }, f.input, check)).rejects.toThrow();
  expect(check).not.toHaveBeenCalled();
});
