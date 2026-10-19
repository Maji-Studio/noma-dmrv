/**
 * Issue #746: registry deletion requires Admin or Owner, while a Removal
 * that never touched the registry remains deletable by a Member.
 * Real Postgres owns claims and persistence; only the registry is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import {
  claimRemovalDeletion,
  finalizeRemovalDeletion,
  releaseRemovalDeletionClaim,
  REMOVAL_DELETE_ALREADY_DELETING_ERROR,
  REMOVAL_DELETE_ROLE_ERROR,
  REMOVAL_DELETE_SUBMITTED_ERROR,
  type RemovalDeletionRegistryOutcome,
} from "@/data-access/certifier-removal-deletion";
import { markRemovalSubmissionExternalMutationPossible } from "@/data-access/certifier-removals";
import { deleteRemoval } from "@/fn/certification/delete-removal";
import type { OrgContext } from "@/lib/auth/server";
import { REMOVAL_DELETION_LEASE_KEY } from "@/lib/certification/removal-deletion-lease";
import { REMOVAL_REGISTRY_DELETION_MIN_ROLE } from "@/lib/certification/removal-deletion-role";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_EXTERNAL_MUTATIONS,
} from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import { buildProductionBatchReference } from "@/lib/isometric/production-batches";
import { installFakeRegistry, type FakeIsometricRegistry } from "./fixtures/fake-registry";
import { createBiocharApplicationChain, type BiocharApplicationChain } from "./helpers/biochar-application-chain";
import { deleteOutputFacilityFixtures } from "./helpers/output-contract-fixtures";
import { createRemovalDeletionFixture, insertLedgerRow, type Fixture } from "./helpers/removal-deletion-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

vi.mock("@/data-access/certifier-credentials", async (importOriginal) =>
  (await import("./fixtures/fake-registry")).fakeCredentialsModule(importOriginal),
);
vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});

const APPLIED_WET_MASS_KG = 12_000;
const APPLIED_DRY_MASS_KG = 10_800;
const PRIOR_LOCKED_AT = new Date("2026-01-01T00:00:00Z");
const EXPECTED_ROLE_ERROR =
  "Only Owners and Admins can delete a Removal that may have records on Isometric. Ask an Owner or Admin to delete it.";
const memberCtx: OrgContext = { ...makeTestOrgContext(), orgRole: "member" };
const adminCtx: OrgContext = { ...makeTestOrgContext(), orgRole: "admin" };
const emptyRegistryOutcome: RemovalDeletionRegistryOutcome = {
  deletedGhgEntryIds: [],
  deletedBiocharApplicationIds: [],
  absentGhgEntryIds: [],
  absentBiocharApplicationIds: [],
  unresolvedBiocharApplicationReferences: [],
  productionBatches: [],
  measurementSamples: [],
};
const roles: Array<{ name: string; ctx: OrgContext; allowedAtRegistry: boolean }> = [
  { name: "member", ctx: memberCtx, allowedAtRegistry: false },
  {
    name: "admin",
    ctx: { ...makeTestOrgContext(), orgRole: "admin" },
    allowedAtRegistry: true,
  },
  { name: "owner", ctx: makeTestOrgContext(), allowedAtRegistry: true },
  {
    name: "platform admin outside the organization",
    ctx: { ...makeTestOrgContext(), orgRole: null, isPlatformAdmin: true },
    allowedAtRegistry: true,
  },
];
const createdFacilityIds: string[] = [];
const createdRemovalIds: string[] = [];
const createdBatchIds: string[] = [];
const createdFeedstockTypeIds: string[] = [];
const createdChains: BiocharApplicationChain[] = [];
let registry: FakeIsometricRegistry;

beforeAll(async () => {
  await ensureTestOrg();
});
beforeEach(() => {
  registry = installFakeRegistry();
});
afterAll(async () => {
  // Remove dependent registrations and slices before their application chains.
  if (createdBatchIds.length > 0) {
    await db.delete(creditBatchApplications)
      .where(inArray(creditBatchApplications.creditBatchId, createdBatchIds));
    await db.delete(certifierBiocharApplications)
      .where(inArray(certifierBiocharApplications.creditBatchId, createdBatchIds));
  }
  for (const chain of [...createdChains].reverse()) await chain.cleanup();
  if (createdBatchIds.length > 0) {
    await db.delete(certifierProductionBatches)
      .where(inArray(certifierProductionBatches.creditBatchId, createdBatchIds));
    await db.delete(activityEvents)
      .where(inArray(activityEvents.creditBatchId, createdBatchIds));
    // Batches reference both their reservation ledger row and claimed Removal.
    await db.delete(creditBatches).where(inArray(creditBatches.id, createdBatchIds));
  }
  if (createdRemovalIds.length > 0) {
    await db.delete(activityEvents).where(and(
      eq(activityEvents.organizationId, TEST_ORG_ID),
      inArray(activityEvents.entityId, createdRemovalIds),
    ));
    await db.delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, createdRemovalIds));
    await db.delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, createdRemovalIds));
    await db.delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, createdRemovalIds));
  }
  if (createdFacilityIds.length > 0) {
    await db.delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, createdFacilityIds));
    await db.delete(certifierProjects)
      .where(inArray(certifierProjects.facilityId, createdFacilityIds));
    await deleteOutputFacilityFixtures(db, inArray(facilities.id, createdFacilityIds));
  }
  if (createdFeedstockTypeIds.length > 0) {
    await db.delete(feedstockTypes)
      .where(inArray(feedstockTypes.id, createdFeedstockTypeIds));
  }
});

const createFixture = () => createRemovalDeletionFixture({
  createdFacilityIds, createdRemovalIds, createdBatchIds, createdFeedstockTypeIds,
});

async function removalRows(fixture: Fixture) {
  return db.select().from(certifierRemovals)
    .where(eq(certifierRemovals.id, fixture.removalId));
}

async function persistedState(fixture: Fixture) {
  const removals = await removalRows(fixture);
  const ledger = await db.select().from(certificationSubmissions)
    .where(eq(certificationSubmissions.localEntityId, fixture.removalId))
    .orderBy(certificationSubmissions.id);
  const batches = await db.select({
    id: creditBatches.id,
    claimedBy: creditBatches.productionEmissionsClaimedByRemovalId,
    reservedBy: creditBatches.productionEmissionsClaimReservedBySubmissionId,
  }).from(creditBatches).where(eq(creditBatches.id, fixture.creditBatchId));
  const slices = await db.select().from(creditBatchApplications)
    .where(eq(creditBatchApplications.creditBatchId, fixture.creditBatchId));
  const registrations = await db.select().from(certifierProductionBatches)
    .where(eq(certifierProductionBatches.creditBatchId, fixture.creditBatchId));
  return { removals, ledger, batches, slices, registrations };
}

async function expectUnchangedRefusal(
  fixture: Fixture,
  operation: () => Promise<unknown>,
  expectedMessage: string = REMOVAL_DELETE_ROLE_ERROR,
) {
  const before = await persistedState(fixture);
  const ghgEntriesBefore = structuredClone(registry.ghgEntries);
  const productionBatchesBefore = structuredClone(registry.productionBatches);
  const error: unknown = await operation().then(() => undefined, (reason: unknown) => reason);

  // Soft assertions also inspect side effects when today's implementation
  // wrongly succeeds, instead of stopping at the missing refusal.
  expect.soft(error).toBeInstanceOf(SafeError);
  expect.soft(error).toHaveProperty("message", expectedMessage);
  const after = await persistedState(fixture);
  expect.soft(after.removals).toHaveLength(1);
  expect.soft(after.removals[0]?.metadata ?? {})
    .not.toHaveProperty(REMOVAL_DELETION_LEASE_KEY);
  expect.soft(after).toEqual(before);
  for (const row of before.ledger) {
    const unchanged = after.ledger.find((candidate) => candidate.id === row.id);
    expect.soft(unchanged?.lockedAt).toEqual(row.lockedAt);
    expect.soft(unchanged?.metadata ?? {})
      .not.toHaveProperty("lastAttemptOutcome", "deleting");
  }
  expect.soft(registry.requests.filter((request) => request.method === "DELETE"))
    .toEqual([]);
  expect.soft(registry.ghgEntries).toEqual(ghgEntriesBefore);
  expect.soft(registry.productionBatches).toEqual(productionBatchesBefore);
}

async function markRegistryBoundary(fixture: Fixture) {
  await db.update(certifierRemovals)
    .set({ metadata: sql`coalesce(${certifierRemovals.metadata}, '{}'::jsonb) || ${JSON.stringify({ submissionExternalMutationPossible: true })}::jsonb` })
    .where(eq(certifierRemovals.id, fixture.removalId));
}

function interruptedMetadata() {
  return {
    lastAttemptOutcome: SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
    externalMutation: SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
    lastError: "Creating Removal in Isometric failed",
  };
}

async function registerProductionBatch(fixture: Fixture) {
  const chain = await createBiocharApplicationChain({
    tag: `FLOOR-${fixture.runId}`,
    facilityId: fixture.facilityId,
    creditBatchId: fixture.creditBatchId,
    certifierProjectId: fixture.certifierProjectId,
    externalProjectId: fixture.externalProjectId,
  });
  createdChains.push(chain);
  const supplierReference = buildProductionBatchReference({ creditBatchId: fixture.creditBatchId });
  const externalFacilityId = `fcl_${fixture.runId}`;
  await db.update(certifierProductionBatches)
    .set({ supplierReference, externalFacilityId })
    .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId));
  await db.insert(creditBatchApplications).values({
    organizationId: TEST_ORG_ID,
    creditBatchId: fixture.creditBatchId,
    applicationId: chain.applicationId,
    removalId: fixture.removalId,
    allocatedWetMassKg: APPLIED_WET_MASS_KG,
    allocatedDryMassKg: APPLIED_DRY_MASS_KG,
  });
  await db.update(creditBatches)
    .set({ productionEmissionsClaimedByRemovalId: fixture.removalId })
    .where(eq(creditBatches.id, fixture.creditBatchId));
  registry.productionBatches.push({
    id: chain.externalProductionBatchId,
    supplier_reference_id: supplierReference,
    facility_id: externalFacilityId,
  });
  return chain;
}

describe("Removal registry deletion policy", () => {
  it("sets the agreed Admin floor and exact refusal message", () => {
    expect(REMOVAL_REGISTRY_DELETION_MIN_ROLE).toBe("admin");
    expect(REMOVAL_DELETE_ROLE_ERROR).toBe(EXPECTED_ROLE_ERROR);
  });
});

describe.each(roles)("deleteRemoval as $name", ({ ctx, allowedAtRegistry }) => {
  it("deletes a fresh Removal without calling the registry", async () => {
    const fixture = await createFixture();
    await deleteRemoval(ctx, fixture);
    expect(registry.requests).toEqual([]);
    expect(await removalRows(fixture)).toEqual([]);
  });

  it("enforces the floor when only the sticky marker opens the boundary", async () => {
    const fixture = await createFixture();
    await markRegistryBoundary(fixture);
    if (!allowedAtRegistry) {
      await expectUnchangedRefusal(fixture, () => deleteRemoval(ctx, fixture));
      return;
    }
    await deleteRemoval(ctx, fixture);
    expect(await removalRows(fixture)).toEqual([]);
  });

  it("enforces the floor before deleting a recorded draft GHG Entry", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      lockedAt: PRIOR_LOCKED_AT,
      metadata: interruptedMetadata(),
      reserveBatch: true,
    });
    await db.update(creditBatches)
      .set({ productionEmissionsClaimedByRemovalId: fixture.removalId })
      .where(eq(creditBatches.id, fixture.creditBatchId));
    if (!allowedAtRegistry) {
      await expectUnchangedRefusal(fixture, () => deleteRemoval(ctx, fixture));
      return;
    }
    const result = await deleteRemoval(ctx, fixture);
    expect(result.deletedGhgEntryIds).toEqual([entry.id]);
    expect(registry.ghgEntries).toEqual([]);
    expect(registry.requestCount("DELETE", `/ghg_entries/${entry.id}`)).toBe(1);
    expect(await removalRows(fixture)).toEqual([]);
  });

  it.each(["draft", "rejected"] as const)(
    "enforces the floor for a %s ledger row without recorded artifacts",
    async (status) => {
      const fixture = await createFixture();
      await insertLedgerRow(fixture, { status, externalId: null, reserveBatch: true });
      if (!allowedAtRegistry) {
        await expectUnchangedRefusal(fixture, () => deleteRemoval(ctx, fixture));
        return;
      }
      await deleteRemoval(ctx, fixture);
      expect(await removalRows(fixture)).toEqual([]);
    },
  );

  it("enforces the floor when only a Production Batch registration opens the boundary", async () => {
    const fixture = await createFixture();
    const chain = await registerProductionBatch(fixture);
    const before = await persistedState(fixture);
    expect(before.ledger).toEqual([]);
    expect(before.removals[0].metadata ?? {})
      .not.toHaveProperty("submissionExternalMutationPossible", true);
    if (!allowedAtRegistry) {
      await expectUnchangedRefusal(fixture, () => deleteRemoval(ctx, fixture));
      return;
    }
    const result = await deleteRemoval(ctx, fixture);
    expect(result.releasedSliceCount).toBe(1);
    expect(registry.productionBatches).toEqual([]);
    expect(registry.requestCount("DELETE", `/production_batches/${chain.externalProductionBatchId}`)).toBe(1);
    expect(await db.select().from(certifierProductionBatches)
      .where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId)))
      .toEqual([]);
    expect(await removalRows(fixture)).toEqual([]);
  });
});

describe("claimRemovalDeletion role floor and refusal ordering", () => {
  it("refuses a member at the claim seam when only the marker opens the boundary", async () => {
    const fixture = await createFixture();
    await markRegistryBoundary(fixture);
    await expectUnchangedRefusal(fixture, () =>
      claimRemovalDeletion(memberCtx, fixture.facilityId, fixture.removalId));
  });

  it("returns the submitted refusal before the role refusal for a member", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "FINALIZED" });
    await insertLedgerRow(fixture, {
      status: "submitted",
      externalId: entry.id,
      reserveBatch: true,
    });
    await markRegistryBoundary(fixture);
    await expectUnchangedRefusal(
      fixture,
      () => deleteRemoval(memberCtx, fixture),
      REMOVAL_DELETE_SUBMITTED_ERROR,
    );
  });
});

describe("Removal deletion role floor when the registry boundary opens after claim", () => {
  it("refuses an Admin's submission marker while a Member holds the deletion lease", async () => {
    const fixture = await createFixture();
    const claim = await claimRemovalDeletion(memberCtx, fixture.facilityId, fixture.removalId);
    try {
      await expect(markRemovalSubmissionExternalMutationPossible(
        adminCtx, fixture.facilityId, fixture.removalId,
      )).rejects.toThrow(new SafeError(REMOVAL_DELETE_ALREADY_DELETING_ERROR));

      const rows = await removalRows(fixture);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).not.toHaveProperty("submissionExternalMutationPossible");
      expect(rows[0].metadata).toHaveProperty(REMOVAL_DELETION_LEASE_KEY, claim.lockedAt.toISOString());
    } finally {
      await releaseRemovalDeletionClaim(memberCtx, claim);
    }
  });

  it("refuses Member finalization after a marker write and allows the lease to be released", async () => {
    const fixture = await createFixture();
    const claim = await claimRemovalDeletion(memberCtx, fixture.facilityId, fixture.removalId);
    try {
      // Simulate a writer bypassing the marker seam without replacing our lease.
      await markRegistryBoundary(fixture);
      const before = await persistedState(fixture);
      expect(before.removals[0].metadata).toHaveProperty(REMOVAL_DELETION_LEASE_KEY, claim.lockedAt.toISOString());

      await expect(finalizeRemovalDeletion(memberCtx, claim, emptyRegistryOutcome))
        .rejects.toThrow(new SafeError(REMOVAL_DELETE_ROLE_ERROR));
      expect(await persistedState(fixture)).toEqual(before);
      expect(await removalRows(fixture)).toHaveLength(1);
    } finally {
      await releaseRemovalDeletionClaim(memberCtx, claim);
    }
    const [removal] = await removalRows(fixture);
    expect(removal.metadata).not.toHaveProperty(REMOVAL_DELETION_LEASE_KEY);
    expect(removal.metadata).toHaveProperty("submissionExternalMutationPossible", true);
  });

  it("refuses Member finalization after a Production Batch registration appears", async () => {
    const fixture = await createFixture();
    const claim = await claimRemovalDeletion(memberCtx, fixture.facilityId, fixture.removalId);
    expect(claim.productionBatches).toEqual([]);
    expect(claim.submissionIds).toEqual([]);
    try {
      await registerProductionBatch(fixture);
      const before = await persistedState(fixture);
      expect(before.ledger).toEqual([]);
      expect(before.registrations).toHaveLength(1);
      expect(before.removals[0].metadata).not.toHaveProperty("submissionExternalMutationPossible");

      await expect(finalizeRemovalDeletion(memberCtx, claim, emptyRegistryOutcome))
        .rejects.toThrow(new SafeError(REMOVAL_DELETE_ROLE_ERROR));
      expect(await persistedState(fixture)).toEqual(before);
      expect(await removalRows(fixture)).toHaveLength(1);
    } finally {
      await releaseRemovalDeletionClaim(memberCtx, claim);
    }
    const [removal] = await removalRows(fixture);
    expect(removal.metadata).not.toHaveProperty(REMOVAL_DELETION_LEASE_KEY);
  });

  it("allows Admin finalization after a marker write opens the boundary", async () => {
    const fixture = await createFixture();
    const claim = await claimRemovalDeletion(adminCtx, fixture.facilityId, fixture.removalId);
    try {
      await markRegistryBoundary(fixture);
      const [removal] = await removalRows(fixture);
      expect(removal.metadata).toHaveProperty(REMOVAL_DELETION_LEASE_KEY, claim.lockedAt.toISOString());
      expect(removal.metadata).toHaveProperty("submissionExternalMutationPossible", true);

      await finalizeRemovalDeletion(adminCtx, claim, emptyRegistryOutcome);
      expect(await removalRows(fixture)).toEqual([]);
    } finally {
      await releaseRemovalDeletionClaim(adminCtx, claim);
    }
  });
});
