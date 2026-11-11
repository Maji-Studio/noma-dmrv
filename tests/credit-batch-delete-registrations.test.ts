/**
 * Deleting a credit batch whose Isometric production batch registration was
 * retained by Removal deletion (issue #644).
 *
 * Real Postgres for the Removal deletion and credit batch delete transactions;
 * the fake registry (`tests/fixtures/fake-registry.ts`) answers the DELETE calls.
 *
 * Requires a real Postgres (`.env.test`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data-access/certifier-credentials", async (importOriginal) =>
  (await import("./fixtures/fake-registry")).fakeCredentialsModule(importOriginal),
);
vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { applications } from "@/db/schema/application";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { upsertProductionBatchRegistration } from "@/data-access/certifier-production-batches";
import { deleteCreditBatch } from "@/data-access/credit-batches";
import { deleteRemoval } from "@/fn/certification/delete-removal";
import { buildProductionBatchReference } from "@/lib/isometric/production-batches";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_EXTERNAL_MUTATIONS,
} from "@/lib/certification/submission-metadata";
import { createBiocharApplicationChain, type BiocharApplicationChain } from "./helpers/biochar-application-chain";
import { deleteOutputFacilityFixtures } from "./helpers/output-contract-fixtures";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { createRemovalDeletionFixture, insertLedgerRow } from "./helpers/removal-deletion-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { installFakeRegistry, type FakeIsometricRegistry } from "./fixtures/fake-registry";

const TIMEOUT_MS = 60_000;
const SLICE_WET_MASS_KG = 12_000;
const SLICE_DRY_MASS_KG = 10_800;
const createdFacilityIds: string[] = [];
const createdRemovalIds: string[] = [];
const createdBatchIds: string[] = [];
const createdFeedstockTypeIds: string[] = [];
const createdApplicationIds: string[] = [];
const createdChains: BiocharApplicationChain[] = [];
let registry: FakeIsometricRegistry;

beforeAll(() => ensureTestOrg());
beforeEach(() => { registry = installFakeRegistry(); });
afterAll(async () => {
  if (createdBatchIds.length) {
    await db.delete(certifierProductionBatches).where(inArray(certifierProductionBatches.creditBatchId, createdBatchIds));
    await db.delete(creditBatchApplications).where(inArray(creditBatchApplications.creditBatchId, createdBatchIds));
  }
  if (createdApplicationIds.length) await db.delete(applications).where(inArray(applications.id, createdApplicationIds));
  for (const chain of createdChains.reverse()) await chain.cleanup();
  if (createdRemovalIds.length) {
    await db.delete(activityEvents).where(and(
      eq(activityEvents.organizationId, TEST_ORG_ID), inArray(activityEvents.entityId, createdRemovalIds)));
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.localEntityId, createdRemovalIds));
    await db.delete(certifierSyncEvents).where(inArray(certifierSyncEvents.entityId, createdRemovalIds));
    await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, createdRemovalIds));
  }
  if (createdBatchIds.length) {
    await db.delete(activityEvents).where(inArray(activityEvents.creditBatchId, createdBatchIds));
    await db.delete(creditBatches).where(inArray(creditBatches.id, createdBatchIds));
  }
  if (createdFacilityIds.length) {
    await db.delete(productionProcesses).where(inArray(productionProcesses.facilityId, createdFacilityIds));
    await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, createdFacilityIds));
    await deleteOutputFacilityFixtures(db, inArray(facilities.id, createdFacilityIds));
  }
  if (createdFeedstockTypeIds.length) {
    await db.delete(feedstockTypes).where(inArray(feedstockTypes.id, createdFeedstockTypeIds));
  }
}, TIMEOUT_MS);

type SharedBy = "draftRemoval" | "otherSubmission";

/**
 * Removal A was sent (its submission was interrupted after Isometric created
 * the GHG Entry and the production batch) and shares credit batch X. With
 * `draftRemoval`, Removal B is a local draft holding another application slice
 * of X. With `otherSubmission`, Removal B holds no slice of X but an earlier
 * draft submission of B named X, which also keeps the registration.
 */
async function sharedBatchAfterRemovalDeletion(sharedBy: SharedBy) {
  const fixture = await createRemovalDeletionFixture({
    createdFacilityIds, createdRemovalIds, createdBatchIds, createdFeedstockTypeIds,
  });
  const ctx = makeTestOrgContext();
  const chain = await createBiocharApplicationChain({ ...fixture, tag: `CBDEL-${fixture.runId}` });
  createdChains.push(chain);
  // The chain seeds its own registration; replace it with the row the submit path writes.
  await db.delete(certifierProductionBatches).where(eq(certifierProductionBatches.id, chain.productionBatchRegistrationId));
  const supplierReference = buildProductionBatchReference({ creditBatchId: fixture.creditBatchId });
  const externalFacilityId = `fcl_test_${fixture.facilityId}`;
  const registration = await upsertProductionBatchRegistration(ctx, {
    creditBatchId: fixture.creditBatchId,
    externalProductionBatchId: `ptb_${fixture.runId}`,
    supplierReference,
    externalProjectId: fixture.externalProjectId,
    externalFacilityId,
    massKg: SLICE_DRY_MASS_KG * 2,
    startedOn: "2026-01-01",
    endedOn: "2026-01-31",
    payloadHash: `ptb-hash-${fixture.runId}`,
  });
  registry.productionBatches.push({
    id: registration.externalProductionBatchId,
    supplier_reference_id: supplierReference,
    facility_id: externalFacilityId,
  });

  const [otherRemoval] = await insertRemovalFixture(db, {
    organizationId: TEST_ORG_ID, facilityId: fixture.facilityId, provider: "isometric",
  });
  createdRemovalIds.push(otherRemoval.id);
  await db.insert(creditBatchApplications).values({
    organizationId: TEST_ORG_ID, creditBatchId: fixture.creditBatchId, applicationId: chain.applicationId,
    removalId: fixture.removalId, allocatedWetMassKg: SLICE_WET_MASS_KG, allocatedDryMassKg: SLICE_DRY_MASS_KG,
  });
  if (sharedBy === "draftRemoval") {
    const [application] = await db.select().from(applications).where(eq(applications.id, chain.applicationId));
    const [otherApplication] = await db.insert(applications).values({
      ...application, id: crypto.randomUUID(), code: `AP-CBDEL-B-${fixture.runId}`,
    }).returning({ id: applications.id });
    createdApplicationIds.push(otherApplication.id);
    await db.insert(creditBatchApplications).values({
      organizationId: TEST_ORG_ID, creditBatchId: fixture.creditBatchId, applicationId: otherApplication.id,
      removalId: otherRemoval.id, allocatedWetMassKg: SLICE_WET_MASS_KG, allocatedDryMassKg: SLICE_DRY_MASS_KG,
    });
  } else {
    await insertLedgerRow({ ...fixture, removalId: otherRemoval.id }, {
      status: "draft", externalId: null, payloadSnapshot: { creditBatchIds: [fixture.creditBatchId] },
    });
  }

  const entry = registry.seedGhgEntry({ status: "DRAFT" });
  await insertLedgerRow(fixture, {
    status: "draft",
    externalId: entry.id,
    metadata: {
      lastAttemptOutcome: SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
      externalMutation: SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
      lastError: "Creating Removal in Isometric failed",
    },
    reserveBatch: true,
  });

  // Deleting the sent Removal keeps the registration, because Removal B shares the batch.
  await deleteRemoval(ctx, { facilityId: fixture.facilityId, removalId: fixture.removalId });
  expect(registry.productionBatches.map((batch) => batch.id)).toEqual([registration.externalProductionBatchId]);
  expect(await registrationsFor(fixture.creditBatchId)).toEqual([registration.id]);

  return { ctx, fixture, registration, otherRemoval };
}

async function registrationsFor(creditBatchId: string): Promise<string[]> {
  const rows = await db.select({ id: certifierProductionBatches.id }).from(certifierProductionBatches)
    .where(eq(certifierProductionBatches.creditBatchId, creditBatchId));
  return rows.map((row) => row.id);
}

async function readBatch(creditBatchId: string) {
  const [batch] = await db.select({ code: creditBatches.code, version: creditBatches.version })
    .from(creditBatches).where(eq(creditBatches.id, creditBatchId));
  return batch;
}

async function slicesFor(creditBatchId: string) {
  return db.select({ applicationId: creditBatchApplications.applicationId, removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, creditBatchId));
}

async function removalExists(removalId: string): Promise<boolean> {
  const rows = await db.select({ id: certifierRemovals.id }).from(certifierRemovals)
    .where(eq(certifierRemovals.id, removalId));
  return rows.length > 0;
}

describe("deleteCreditBatch with a retained production batch registration", { timeout: TIMEOUT_MS }, () => {
  it("refuses while a draft Removal still uses the batch, and deleting that Removal clears the way", async () => {
    const { ctx, fixture, registration, otherRemoval } = await sharedBatchAfterRemovalDeletion("draftRemoval");
    const batch = await readBatch(fixture.creditBatchId);
    const slices = await slicesFor(fixture.creditBatchId);

    await expect(deleteCreditBatch(ctx, fixture.creditBatchId, batch.version)).rejects.toMatchObject({
      name: "ActionConflictError",
      message: `Credit batch ${batch.code} is registered in Isometric and Removal ${otherRemoval.code} still uses it. Delete Removal ${otherRemoval.code} first, then delete the batch.`,
      conflict: { entity: "removal", id: otherRemoval.id, code: otherRemoval.code },
    });
    // Nothing changed: the batch, its slices, the draft Removal and the registration all stay.
    expect(await readBatch(fixture.creditBatchId)).toEqual(batch);
    expect(await slicesFor(fixture.creditBatchId)).toEqual(slices);
    expect(await removalExists(otherRemoval.id)).toBe(true);
    expect(await registrationsFor(fixture.creditBatchId)).toEqual([registration.id]);

    // The next action the refusal names: deleting Removal B removes the production batch from Isometric.
    await deleteRemoval(ctx, { facilityId: fixture.facilityId, removalId: otherRemoval.id });
    expect(registry.requestCount("DELETE", `/production_batches/${registration.externalProductionBatchId}`)).toBe(1);
    expect(registry.productionBatches).toEqual([]);
    expect(await registrationsFor(fixture.creditBatchId)).toEqual([]);

    const released = await readBatch(fixture.creditBatchId);
    await deleteCreditBatch(ctx, fixture.creditBatchId, released.version);
    expect(await readBatch(fixture.creditBatchId)).toBeUndefined();
    expect(await slicesFor(fixture.creditBatchId)).toEqual([]);
  });

  it("refuses with a support step when no Removal holds the batch", async () => {
    const { ctx, fixture, registration } = await sharedBatchAfterRemovalDeletion("otherSubmission");
    const batch = await readBatch(fixture.creditBatchId);

    await expect(deleteCreditBatch(ctx, fixture.creditBatchId, batch.version)).rejects.toMatchObject({
      name: "ActionConflictError",
      message: `Credit batch ${batch.code} is still registered in Isometric as production batch ${registration.externalProductionBatchId}. Ask support to remove that registration, then delete the batch.`,
      conflict: { entity: "credit_batch", id: fixture.creditBatchId, code: batch.code },
    });
    expect(await readBatch(fixture.creditBatchId)).toEqual(batch);
    expect(await registrationsFor(fixture.creditBatchId)).toEqual([registration.id]);
  });
});
