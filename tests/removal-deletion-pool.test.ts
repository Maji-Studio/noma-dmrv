import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierProjects, certifierRemovals } from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { claimRemovalDeletion, withRemovalDeletionMutation } from "@/data-access/certifier-removal-deletion";
import { claimSubmissionDraft } from "@/data-access/certification-submissions";
import { REMOVAL_DELETION_LEASE_KEY } from "@/lib/certification/removal-deletion-lease";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { createRemovalDeletionFixture } from "./helpers/removal-deletion-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const { POOL_LOCK_TIMEOUT_MS } = vi.hoisted(() => ({ POOL_LOCK_TIMEOUT_MS: 100 }));
const PROGRESS_DEADLINE_MS = 2_000;
const TEST_TIMEOUT_MS = 15_000;
const ctx = makeTestOrgContext();

vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return {
    ...original,
    env: { ...original.env, DB_POOL_MAX: 1, DB_POOL_LOCK_TIMEOUT_MS: POOL_LOCK_TIMEOUT_MS },
  };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// A failure deadline, not a synchronization sleep: finally can release the
// dedicated locks even when a broken pool configuration waits forever.
async function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Pool did not make progress while remote DELETE was pending")), PROGRESS_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(async () => { await ensureTestOrg(); });

describe("Removal deletion with a single application pool connection", () => {
  it.each(["replacement deletion", "first submission"] as const)(
    "times out a pooled %s and releases its slot while remote DELETE remains pending",
    async (contenderKind) => {
      const tracked = {
        createdFacilityIds: [] as string[], createdRemovalIds: [] as string[],
        createdBatchIds: [] as string[], createdFeedstockTypeIds: [] as string[],
      };
      const remoteEntered = deferred();
      const remoteGate = deferred();
      const contenderEntered = deferred();
      const pending: Promise<unknown>[] = [];
      let remoteFinished = false;
      let restoreTransaction: (() => void) | undefined;

      try {
        const fixture = await createRemovalDeletionFixture(tracked);
        const claimed = await claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId);
        // Submission's optimistic freshness check must reach the actual lock.
        const expiredAt = new Date(Date.now() - LOCK_TTL_MS - 1);
        await db.update(certifierRemovals)
          .set({ metadata: { [REMOVAL_DELETION_LEASE_KEY]: expiredAt.toISOString() } })
          .where(eq(certifierRemovals.id, fixture.removalId));

        const mutation = withRemovalDeletionMutation(ctx, { ...claimed, lockedAt: expiredAt }, async (tx) => {
          const settings = await tx.execute(sql`show lock_timeout`);
          expect(settings.rows).toEqual([{ lock_timeout: "0" }]);
          remoteEntered.resolve();
          await remoteGate.promise;
          // Exercise the transaction after the pooled contender has timed out.
          await tx.execute(sql`select 1`);
          remoteFinished = true;
          return "deleted";
        });
        pending.push(mutation);
        await withinDeadline(Promise.race([
          remoteEntered.promise,
          mutation.then(() => { throw new Error("Remote callback finished before its gate opened"); }),
        ]));

        const originalTransaction = db.transaction.bind(db);
        const spy = vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
          originalTransaction((tx) => {
            // BEGIN has completed, so this contender owns the sole pool slot.
            contenderEntered.resolve();
            return callback(tx);
          }, config),
        );
        restoreTransaction = () => spy.mockRestore();
        const contender = contenderKind === "replacement deletion"
          ? claimRemovalDeletion(ctx, fixture.facilityId, fixture.removalId)
          : claimSubmissionDraft(ctx, {
            key: { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId },
            guard: { facilityId: fixture.facilityId, provider: "isometric", expectedExternalProjectId: fixture.externalProjectId },
            policy: { onSubmittedHashChanged: "supersede" },
            tentativeInputs: {}, hashOf: () => "pool-contention-test",
            buildSnapshot: () => ({ payloadSnapshot: {} }),
          });
        // Attach the rejection handler immediately, including on failure paths.
        const outcome = contender.then(
          (value) => ({ status: "fulfilled", value }),
          (error: unknown) => ({ status: "rejected", error }),
        );
        pending.push(outcome);
        await withinDeadline(Promise.race([
          contenderEntered.promise,
          outcome.then(() => { throw new Error("Contender finished before acquiring the pool slot"); }),
        ]));

        const read = db.select({ id: facilities.id }).from(facilities)
          .where(eq(facilities.id, fixture.facilityId)).then((rows) => rows);
        pending.push(read);
        expect(await withinDeadline(outcome)).toMatchObject({
          status: "rejected", error: { cause: { code: "55P03" } },
        });
        expect(await withinDeadline(read)).toEqual([{ id: fixture.facilityId }]);
        expect(remoteFinished).toBe(false);
        const settings = await withinDeadline(db.execute(sql`show lock_timeout`));
        expect(settings.rows).toEqual([{ lock_timeout: `${POOL_LOCK_TIMEOUT_MS}ms` }]);

        remoteGate.resolve();
        await expect(withinDeadline(mutation)).resolves.toBe("deleted");
        expect(remoteFinished).toBe(true);
      } finally {
        remoteGate.resolve();
        restoreTransaction?.();
        await Promise.allSettled(pending);
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
      }
    },
    TEST_TIMEOUT_MS,
  );
});
