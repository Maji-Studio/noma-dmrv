import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, withDedicatedLockConnection, type DbTransaction } from "@/db";
import { certificationSubmissions, certifierProjects, certifierRemovals } from "@/db/schema/certification";
import { creditBatches, creditBatchApplications } from "@/db/schema/credits";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { claimRemovalDeletion, withRemovalDeletionMutation } from "@/data-access/certifier-removal-deletion";
import { claimSubmissionDraft } from "@/data-access/certification-submissions";
import { assertNoRemovalBatchDeletion, isRemovalProductionBatchShared } from "@/data-access/removal-production-batch-deletion";
import { REMOVAL_DELETION_LEASE_KEY } from "@/lib/certification/removal-deletion-lease";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { buildProductionBatchReference } from "@/lib/isometric/production-batches";
import { createBiocharApplicationChain, type BiocharApplicationChain } from "./helpers/biochar-application-chain";
import { createRemovalDeletionFixture, insertLedgerRow, type Fixture } from "./helpers/removal-deletion-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const LOCK_WAIT_MS = 100;
const tracked = { createdFacilityIds: [] as string[], createdRemovalIds: [] as string[],
  createdBatchIds: [] as string[], createdFeedstockTypeIds: [] as string[] };
const chains: BiocharApplicationChain[] = [];
const ctx = makeTestOrgContext();

beforeAll(async () => { await ensureTestOrg(); });
afterAll(async () => {
  for (const chain of chains.reverse()) {
    await db.delete(creditBatchApplications).where(eq(creditBatchApplications.applicationId, chain.applicationId));
    await db.delete(certifierBiocharApplications).where(eq(certifierBiocharApplications.applicationId, chain.applicationId));
    await chain.cleanup();
  }
  if (tracked.createdBatchIds.length) await db.delete(creditBatches).where(inArray(creditBatches.id, tracked.createdBatchIds));
  if (tracked.createdRemovalIds.length) {
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.localEntityId, tracked.createdRemovalIds));
    await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, tracked.createdRemovalIds));
  }
  if (tracked.createdFacilityIds.length) {
    await db.delete(productionProcesses).where(inArray(productionProcesses.facilityId, tracked.createdFacilityIds));
    await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, tracked.createdFacilityIds));
    await db.delete(facilities).where(inArray(facilities.id, tracked.createdFacilityIds));
  }
  if (tracked.createdFeedstockTypeIds.length) await db.delete(feedstockTypes).where(inArray(feedstockTypes.id, tracked.createdFeedstockTypeIds));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function submit(fixture: Fixture, tx?: DbTransaction) {
  return claimSubmissionDraft(ctx, {
    key: { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId },
    guard: { facilityId: fixture.facilityId, provider: "isometric", expectedExternalProjectId: fixture.externalProjectId },
    policy: { onSubmittedHashChanged: "supersede" }, tentativeInputs: {}, hashOf: () => "mutation-test",
    buildSnapshot: () => ({ payloadSnapshot: {} }),
  }, tx);
}

async function expireLease(fixture: Fixture) {
  const expiredAt = new Date(Date.now() - LOCK_TTL_MS - 1);
  await db.update(certifierRemovals).set({ metadata: { [REMOVAL_DELETION_LEASE_KEY]: expiredAt.toISOString() } })
    .where(eq(certifierRemovals.id, fixture.removalId));
  return expiredAt;
}

describe("Removal destructive registry callback locks", () => {
  it("fences membership and first submission through a remote call after lease expiry", async () => {
    const fixture = await createRemovalDeletionFixture(tracked);
    const chain = await createBiocharApplicationChain({ ...fixture, tag: `MUT-${fixture.runId}` });
    chains.push(chain);
    await db.update(certifierProductionBatches).set({ supplierReference: buildProductionBatchReference({ creditBatchId: fixture.creditBatchId }) })
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId));
    await db.insert(creditBatchApplications).values({ organizationId: TEST_ORG_ID, creditBatchId: fixture.creditBatchId,
      applicationId: chain.applicationId, removalId: fixture.removalId, allocatedWetMassKg: 12_000, allocatedDryMassKg: 10_800 });
    const claimed = await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
    const claim = { ...claimed, lockedAt: await expireLease(fixture) };
    const entered = deferred();
    const complete = deferred();
    const mutation = withRemovalDeletionMutation(ctx, claim, async (tx) => {
      expect(await isRemovalProductionBatchShared(ctx, claim, claim.productionBatches![0], tx)).toBe(false);
      entered.resolve();
      await complete.promise;
      return "deleted";
    });
    try {
      await Promise.race([entered.promise, mutation]);
      await expect(withDedicatedLockConnection(async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`);
        // createRemovalWithCreditBatches takes this row lock before its membership check.
        await tx.select({ id: creditBatches.id }).from(creditBatches).where(eq(creditBatches.id, fixture.creditBatchId)).for("update");
        await assertNoRemovalBatchDeletion(ctx, [fixture.creditBatchId], tx);
      })).rejects.toMatchObject({ cause: { code: "55P03" } });
      await expect(withDedicatedLockConnection(async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`);
        return submit(fixture, tx);
      })).rejects.toMatchObject({ cause: { code: "55P03" } });
    } finally { complete.resolve(); }
    await expect(mutation).resolves.toBe("deleted");
    await expect(submit(fixture)).resolves.toMatchObject({ kind: "claimed" });
  });

  it.each(["replacement deletion", "new submission"])("refuses stale remote work after %s", async (takeover) => {
    const fixture = await createRemovalDeletionFixture(tracked);
    const claimed = await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
    const claim = { ...claimed, lockedAt: await expireLease(fixture) };
    if (takeover === "replacement deletion") await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
    else await insertLedgerRow(fixture, { status: "draft", externalId: null });
    const remoteDelete = vi.fn(async () => undefined);
    await expect(withRemovalDeletionMutation(ctx, claim, remoteDelete)).rejects.toThrow("changed");
    expect(remoteDelete).not.toHaveBeenCalled();
  });
});
