/** Real PostgreSQL coverage. Do not run in a sandbox without a test database. */
import { certifierBiocharApplications, creditBatches, feedstockTypes, productionProcesses } from "@/db/schema";
import { createBiocharApplicationChain } from "./helpers/biochar-application-chain";
import { buildCreateBiocharApplicationRequest } from "@/lib/isometric/biochar-applications";
import { IsometricApiError } from "@/lib/isometric/client";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { checkRemovalRegistryPresenceCore, prepareRemovalResendCore } from "@/fn/certification/removal-resend-core";

import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierGhgStatements, certifierProjects, certifierRemovals, certifierSyncEvents } from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { deleteOutputFacilityFixtures } from "./helpers/output-contract-fixtures";
import { activityEvents } from "@/db/schema/activity";
import { retireMissingRemovalSubmission, removalResendKey } from "@/data-access/removal-resend";
import { claimSubmissionDraft, getLatestSubmission } from "@/data-access/certification-submissions";
import { REMOVAL_RESEND_OPERATION } from "@/lib/certification/removal-registry-presence";
import { REMOVAL_SUBMISSION_CLAIM_POLICY } from "@/lib/isometric/utils/submission-claim";
import { isSentRemoval } from "@/lib/record-lock";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";
import { insertRemovalFixture } from "./helpers/removal-fixture";

const remote = vi.hoisted(() => ({ get: vi.fn(), paginateAll: vi.fn() }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => remote) }));

const ctx = makeTestOrgContext();
const removalIds: string[] = [];
const facilityIds: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  remote.get.mockReset().mockRejectedValue(new IsometricApiError("Missing", 404));
  remote.paginateAll.mockReset().mockResolvedValue([]);
});
beforeAll(() => ensureTestOrg(db));
afterAll(async () => {
  if (!removalIds.length) return;
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, TEST_ORG_ID), inArray(activityEvents.entityId, removalIds)));
  await db.delete(certifierSyncEvents).where(inArray(certifierSyncEvents.entityId, removalIds));
  for (const cleanup of cleanups.reverse()) await cleanup();
  await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.localEntityId, removalIds));
  await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, removalIds));
  await db.delete(certifierGhgStatements).where(inArray(certifierGhgStatements.facilityId, facilityIds));
  await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, facilityIds));
  await db.delete(productionProcesses).where(inArray(productionProcesses.facilityId, facilityIds));
  await deleteOutputFacilityFixtures(db, inArray(facilities.id, facilityIds));
});

async function fixture() {
  const tag = crypto.randomUUID();
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, timezone: "UTC", organizationId: TEST_ORG_ID,
    name: `Resend ${tag}`, code: `RS-${tag}`, durabilityOption: "200_year" }).returning();
  facilityIds.push(facility.id);
  const externalProjectId = `prj_${tag}`;
  const [project] = await db.insert(certifierProjects).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, provider: "isometric", externalFacilityId: `fcl_${tag}`, externalProjectId }).returning();
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: TEST_ORG_ID, facilityId: facility.id,
    provider: "isometric", reportingPeriodEndOn: "2026-12-31" }).returning();
  const [removal] = await insertRemovalFixture(db, { organizationId: TEST_ORG_ID, facilityId: facility.id, provider: "isometric", ghgStatementId: statement.id });
  removalIds.push(removal.id);
  const key = removalResendKey(removal.id);
  const [submission] = await db.insert(certificationSubmissions).values({ ...key, organizationId: TEST_ORG_ID,
    status: "submitted", version: 1, externalId: `rmv_${tag}`, submittedAt: new Date(), lockedAt: null,
    payloadHash: "same", payloadSnapshot: { semantic: { externalProjectId, inputs: [] } }, metadata: { retained: true } }).returning();
  return { tag, project, input: { facilityId: facility.id, removalId: removal.id }, key, submission, externalProjectId };
}

type LedgerRow = { id: string; status: string; externalId: string | null; submittedAt: Date | null };
const toLock = (row: LedgerRow) => ({ id: row.id, status: row.status, externalId: row.externalId, submittedAt: row.submittedAt?.toISOString() ?? null });

it("atomically retires, audits, unlinks, stays Sent and claims today's v2; concurrent retries are no-ops", async () => {
  const f = await fixture();
  const check = vi.fn(async () => "missing" as const);
  expect(isSentRemoval({ id: f.input.removalId, statements: [], submissions: [toLock(f.submission)] })).toBe(true);
  const results = await Promise.all([
    retireMissingRemovalSubmission(ctx, f.input, check, check), retireMissingRemovalSubmission(ctx, f.input, check, check),
  ]);
  expect(results.filter(result => result.prepared)).toHaveLength(1);
  expect(check).toHaveBeenCalledTimes(2);
  expect(check).toHaveBeenCalledWith(f.submission.externalId, f.externalProjectId);
  const retired = await getLatestSubmission(ctx, f.key);
  expect(retired).toMatchObject({ status: "superseded", supersededAt: expect.any(Date), externalId: f.submission.externalId, submittedAt: f.submission.submittedAt,
    payloadSnapshot: f.submission.payloadSnapshot, metadata: { retained: true, registryMissingExternalId: f.submission.externalId,
      registryMissingConfirmedAt: expect.any(String) } });
  expect(deriveSubmissionStatus(retired, false, "removal", "unknown").kind).toBe("submitted");
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
  await expect(retireMissingRemovalSubmission(ctx, f.input, async () => presence, async () => "missing")).rejects.toThrow();
  expect(await getLatestSubmission(ctx, f.key)).toEqual(f.submission);
  const [removal] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, f.input.removalId));
  expect(removal.ghgStatementId).not.toBeNull();
  expect(await db.select().from(certifierSyncEvents).where(eq(certifierSyncEvents.entityId, f.input.removalId))).toHaveLength(0);
});

it("rejects wrong organization, facility and non-admin access before registry I/O", async () => {
  const f = await fixture();
  const check = vi.fn(async () => "missing" as const);
  await expect(retireMissingRemovalSubmission({ ...ctx, organizationId: "other" }, f.input, check, check)).rejects.toThrow();
  await expect(retireMissingRemovalSubmission(ctx, { ...f.input, facilityId: crypto.randomUUID() }, check, check)).rejects.toThrow();
  await expect(retireMissingRemovalSubmission({ ...ctx, orgRole: "member" }, f.input, check, check)).rejects.toThrow();
  expect(check).not.toHaveBeenCalled();
});


async function applicationFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const [feedstock] = await db.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID,
    code: `FT-${f.tag}`, name: `Resend ${f.tag}`, category: "forestry", usage: "pyrolysis" }).returning();
  const [process] = await db.insert(productionProcesses).values({ organizationId: TEST_ORG_ID,
    facilityId: f.input.facilityId, feedstockTypeId: feedstock.id }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId: TEST_ORG_ID,
    facilityId: f.input.facilityId, feedstockTypeId: feedstock.id, productionProcessId: process.id,
    code: `CB-${f.tag}`, startDate: "2026-04-01", endDate: "2026-04-30" }).returning();
  const chain = await createBiocharApplicationChain({ tag: f.tag, facilityId: f.input.facilityId,
    creditBatchId: batch.id, certifierProjectId: f.project.id, externalProjectId: f.externalProjectId });
  const externalApplicationId = `bca_${f.tag}`;
  const [registration] = await db.insert(certifierBiocharApplications).values({ organizationId: TEST_ORG_ID,
    applicationId: chain.applicationId, creditBatchId: batch.id, removalSubmissionId: f.submission.id,
    productionBatchRegistrationId: chain.productionBatchRegistrationId, storageLocationRegistrationId: chain.storageLocationRegistrationId,
    externalProductionBatchId: chain.externalProductionBatchId, externalStorageLocationId: chain.externalStorageLocationId,
    externalApplicationId, supplierReference: `resend-${f.tag}`, payloadHash: "original",
    submittedPayload: buildCreateBiocharApplicationRequest({ applicationCode: `AP-${f.tag}`, applicationDate: "2026-04-05",
      applicationWetMassKg: 12_000, fieldSizeHa: 4, externalProjectId: f.externalProjectId,
      externalProductionBatchId: chain.externalProductionBatchId, externalStorageLocationId: chain.externalStorageLocationId,
      supplierReferenceId: `resend-${f.tag}`, sourceIds: [] }),
  }).returning();
  cleanups.push(async () => {
    await db.delete(certifierBiocharApplications).where(eq(certifierBiocharApplications.id, registration.id));
    await chain.cleanup();
    await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
    await db.delete(productionProcesses).where(eq(productionProcesses.id, process.id));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstock.id));
  });
  return registration;
}

it.each(["present", "unknown", "missing"] as const)("checks the version's Application: %s", async presence => {
  const f = await fixture();
  const registration = await applicationFixture(f);
  remote.get.mockImplementation(async (path: string) => {
    if (path === `/biochar_applications/${registration.externalApplicationId}`) {
      if (presence === "present") return { id: registration.externalApplicationId };
      if (presence === "unknown") throw new IsometricApiError("Unavailable", 503);
    }
    throw new IsometricApiError("Missing", 404);
  });
  if (presence === "missing") {
    await expect(prepareRemovalResendCore(ctx, f.input)).resolves.toMatchObject({ prepared: true });
    const retired = await getLatestSubmission(ctx, f.key);
    expect(retired?.supersededAt).toBeInstanceOf(Date);
    expect(deriveSubmissionStatus(retired, false, "removal", "unknown").kind).toBe("submitted");
  } else {
    await expect(prepareRemovalResendCore(ctx, f.input)).rejects.toThrow(presence === "present"
      ? `Applications AP-${f.tag} are still in Isometric. Remove them there first.` : "could not confirm");
    expect(await getLatestSubmission(ctx, f.key)).toEqual(f.submission);
    const [removal] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, f.input.removalId));
    expect(removal.ghgStatementId).not.toBeNull();
    expect(await db.select().from(certifierSyncEvents).where(eq(certifierSyncEvents.entityId, f.input.removalId))).toHaveLength(0);
  }
  expect(remote.get).toHaveBeenCalledWith(`/biochar_applications/${registration.externalApplicationId}`);
  expect(await db.select().from(certifierBiocharApplications).where(eq(certifierBiocharApplications.id, registration.id))).toEqual([registration]);
});

it("returns unknown and refuses retirement when the project mapping differs", async () => {
  const f = await fixture();
  await db.update(certifierProjects).set({ externalProjectId: "prj_other" }).where(eq(certifierProjects.id, f.project.id));
  expect(await checkRemovalRegistryPresenceCore(ctx, f.input)).toBe("unknown");
  await expect(prepareRemovalResendCore(ctx, f.input)).rejects.toThrow("could not confirm");
  expect(await getLatestSubmission(ctx, f.key)).toEqual(f.submission);
  expect(remote.get).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 503])("cannot confirm absence when the project GET fails with %s", async status => {
  const f = await fixture();
  remote.paginateAll.mockRejectedValue(new IsometricApiError("Project unavailable", status));
  expect(await checkRemovalRegistryPresenceCore(ctx, f.input)).toBe("unknown");
  await expect(prepareRemovalResendCore(ctx, f.input)).rejects.toThrow("could not confirm");
  expect(await getLatestSubmission(ctx, f.key)).toEqual(f.submission);
  expect(remote.get).not.toHaveBeenCalled();
});
