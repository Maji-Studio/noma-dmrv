import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed tests for the durability-tier edit guard on `updateFacility`.
 *
 * Since ADR 0021 the durability tier (200-year / 1000-year) is declared once
 * per facility and JOIN-derived onto every batch at read time — there is no
 * per-batch durability column. Flipping the facility tier therefore
 * retroactively reinterprets every existing batch under it (e.g. a 200→1000-year
 * flip collapses a soil-temp-evidenced batch's CO₂e-stored preview to null, and
 * invalidates any registry data built under the old tier).
 *
 * `updateFacility` guards this: once the facility owns a consequential
 * (verified/issued, non-archived) credit batch, the tier is locked. This mirrors
 * the externalProjectId/externalFacilityId registry-invalidation guard in
 * `certification.ts`.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test
 * defaults), mirroring tests/credit-batch-sample-linking.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { creditBatches } from "@/db/schema/credits";
import {
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema/certification";
import { creditBatchStatus } from "@/db/schema/common";
import { updateFacility } from "@/data-access/facilities";
import { SafeError } from "@/lib/errors";

type CreditBatchStatus = (typeof creditBatchStatus.enumValues)[number];

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000909";

const createdIds = {
  facilities: [] as string[],
  feedstockTypes: [] as string[],
  productionProcesses: [] as string[],
  creditBatches: [] as string[],
  certifierRemovals: [] as string[],
  certificationSubmissions: [] as string[],
};

const runId = Date.now().toString(36);
let seq = 0;

interface FacilityChain {
  facilityId: string;
  feedstockTypeId: string;
  productionProcessId: string;
}

/** Create an isolated facility + feedstock-type + production-process chain. */
async function setupFacility(
  tag: string,
  durabilityOption: "200_year" | "1000_year",
): Promise<FacilityChain> {
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Durability-Guard ${tag} ${runId}`,
      code: `FAC-DG-${tag}-${runId}`,
      durabilityOption,
    })
    .returning({ id: facilities.id });
  createdIds.facilities.push(facility.id);

  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Durability-Guard Woodchips ${tag} ${runId}`,
      code: `FT-DG-${tag}-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  createdIds.feedstockTypes.push(feedstockType.id);

  const [process] = await db
    .insert(productionProcesses)
    .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id })
    .returning({ id: productionProcesses.id });
  createdIds.productionProcesses.push(process.id);

  return {
    facilityId: facility.id,
    feedstockTypeId: feedstockType.id,
    productionProcessId: process.id,
  };
}

/** Insert a credit batch under the chain with the given status / archived flag. */
async function insertBatch(
  chain: FacilityChain,
  status: CreditBatchStatus,
  archived = false,
): Promise<string> {
  seq += 1;
  const [batch] = await db
    .insert(creditBatches)
    .values({
      organizationId: TEST_ORG_ID,
      code: `CB-DG-${runId}-${seq}`,
      facilityId: chain.facilityId,
      feedstockTypeId: chain.feedstockTypeId,
      productionProcessId: chain.productionProcessId,
      status,
      startDate: "2025-06-01",
      endDate: "2025-06-30",
      archivedAt: archived ? new Date() : null,
    })
    .returning({ id: creditBatches.id });
  createdIds.creditBatches.push(batch.id);
  return batch.id;
}

/**
 * Build a registry-consequential Removal for the facility: a `certifier_removals`
 * row plus a `certification_submissions` ledger row in a blocking status. This
 * is the registry lifecycle the tier guard must respect — it is tracked here,
 * NOT on `credit_batches.status`, so a submitted removal can coexist with
 * `pending` member batches (the gap this regression covers).
 */
async function insertBlockingRemoval(
  chain: FacilityChain,
  status: "draft" | "submitted" | "accepted" = "submitted",
): Promise<void> {
  const [removal] = await db
    .insert(certifierRemovals)
    .values({ organizationId: TEST_ORG_ID, facilityId: chain.facilityId })
    .returning({ id: certifierRemovals.id });
  createdIds.certifierRemovals.push(removal.id);

  const [submission] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
      status,
    })
    .returning({ id: certificationSubmissions.id });
  createdIds.certificationSubmissions.push(submission.id);
}

async function tierOf(facilityId: string): Promise<string> {
  const [row] = await db
    .select({ durabilityOption: facilities.durabilityOption })
    .from(facilities)
    .where(inArray(facilities.id, [facilityId]));
  return row.durabilityOption;
}

beforeAll(() => ensureTestOrg());

beforeAll(async () => {
  // env defaults are applied by tests/setup.ts; nothing else to prepare.
});

afterAll(async () => {
  if (createdIds.certificationSubmissions.length) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.id, createdIds.certificationSubmissions));
  }
  if (createdIds.creditBatches.length) {
    await db.delete(creditBatches).where(inArray(creditBatches.id, createdIds.creditBatches));
  }
  if (createdIds.certifierRemovals.length) {
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, createdIds.certifierRemovals));
  }
  if (createdIds.productionProcesses.length) {
    await db
      .delete(productionProcesses)
      .where(inArray(productionProcesses.id, createdIds.productionProcesses));
  }
  if (createdIds.feedstockTypes.length) {
    await db.delete(feedstockTypes).where(inArray(feedstockTypes.id, createdIds.feedstockTypes));
  }
  if (createdIds.facilities.length) {
    await db.delete(facilities).where(inArray(facilities.id, createdIds.facilities));
  }
});


describe("updateFacility durability-tier guard", () => {
  // Both locking statuses must be exercised — a regression that dropped one from
  // the lock set would otherwise pass while only `issued` is tested.
  for (const status of ["verified", "issued"] as const) {
    it(`rejects a tier change when a ${status} batch exists`, async () => {
      const chain = await setupFacility(`blocked-${status}`, "200_year");
      await insertBatch(chain, status);

      await expect(
        updateFacility(makeTestOrgContext(TEST_USER_ID), chain.facilityId, {
          durabilityOption: "1000_year",
        }),
      ).rejects.toBeInstanceOf(SafeError);

      // The write must not have landed.
      expect(await tierOf(chain.facilityId)).toBe("200_year");
    });
  }

  it("rejects a tier change when a submitted removal exists but its batches are still pending", async () => {
    // Registry submission does not flip `credit_batches.status`; a submitted
    // removal can leave member batches at `pending`. The tier must still lock,
    // since registry data was already built under the current tier.
    const chain = await setupFacility("registry", "200_year");
    await insertBatch(chain, "pending");
    await insertBlockingRemoval(chain, "submitted");

    await expect(
      updateFacility(makeTestOrgContext(TEST_USER_ID), chain.facilityId, {
        durabilityOption: "1000_year",
      }),
    ).rejects.toBeInstanceOf(SafeError);

    expect(await tierOf(chain.facilityId)).toBe("200_year");
  });

  it("allows a tier change on a facility with no consequential batches", async () => {
    const chain = await setupFacility("clean", "200_year");
    // Non-consequential statuses (draft/pending) and archived batches don't lock.
    await insertBatch(chain, "draft");
    await insertBatch(chain, "pending");
    await insertBatch(chain, "issued", /* archived */ true);

    const updated = await updateFacility(makeTestOrgContext(TEST_USER_ID), chain.facilityId, {
      durabilityOption: "1000_year",
    });

    expect(updated.durabilityOption).toBe("1000_year");
  });

  it("allows a non-tier update even when a blocking batch exists", async () => {
    const chain = await setupFacility("noop", "200_year");
    await insertBatch(chain, "verified");

    // Same tier passed through + an unrelated field change must still succeed.
    const updated = await updateFacility(makeTestOrgContext(TEST_USER_ID), chain.facilityId, {
      durabilityOption: "200_year",
      contactEmail: "ops@example.com",
    });

    expect(updated.contactEmail).toBe("ops@example.com");
    expect(updated.durabilityOption).toBe("200_year");
  });
});
