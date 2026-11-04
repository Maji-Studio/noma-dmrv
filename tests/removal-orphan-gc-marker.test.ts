import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  applications,
  certificationSubmissions,
  certifierRemovals,
  creditBatchApplications,
  creditBatches,
  feedstockTypes,
  organizations,
  productionProcesses,
} from "@/db/schema";
import { deleteCreditBatchApplicationSlices } from "@/data-access/credit-batch-delete-slices";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { REMOVAL_EXTERNAL_MUTATION_POSSIBLE_KEY } from "@/lib/certification/removal-external-mutation";
import { createMutationFixture, cleanupMutationFixture } from "./helpers/application-write-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { makeTestOrgContext } from "./helpers/test-org";

// Requires real Postgres via .env.test. No registry calls or database mocks.
describe("Removal orphan GC through credit batch slice deletion", () => {
  it.each([
    { marked: true, outcome: "keeps" },
    { marked: false, outcome: "deletes" },
  ])("$outcome a ledger-free Removal after a member removes its only slice (marker: $marked)", async ({ marked }) => {
    const organizationId = `org_removal_gc_${crypto.randomUUID()}`;
    const ctx = { ...makeTestOrgContext(), organizationId, orgRole: "member" as const };
    let chain: Awaited<ReturnType<typeof createMutationFixture>> | undefined;
    await db.insert(organizations).values({
      id: organizationId, name: "Removal GC tests", slug: organizationId,
    });

    try {
      chain = await createMutationFixture(crypto.randomUUID(), organizationId);
      const { facilityId, deliveryIds } = chain;
      const fixture = await db.transaction(async (tx) => {
        const [feedstockType] = await tx.insert(feedstockTypes).values({
          organizationId, code: "FT-GC", name: "GC feedstock", category: "forestry", usage: "pyrolysis",
        }).returning();
        const [process] = await tx.insert(productionProcesses).values({
          organizationId, facilityId, feedstockTypeId: feedstockType.id,
        }).returning();
        const [batch] = await tx.insert(creditBatches).values({
          organizationId, facilityId, feedstockTypeId: feedstockType.id,
          productionProcessId: process.id, code: "CB-GC",
          startDate: "2025-07-01", endDate: "2025-07-31", certifier: "isometric",
        }).returning();
        const [removal] = await insertRemovalFixture(tx, {
          organizationId, facilityId,
          metadata: marked ? { [REMOVAL_EXTERNAL_MUTATION_POSSIBLE_KEY]: true } : null,
        });
        const [application] = await tx.insert(applications).values({
          organizationId, code: "AP-GC", deliveryId: deliveryIds[0],
          applicationDate: new Date("2025-07-08T00:00:00Z"),
          biocharAppliedTons: 0.2, biocharAppliedDryTons: 0.19, fieldSizeHa: 1,
        }).returning();
        await tx.insert(creditBatchApplications).values({
          organizationId, creditBatchId: batch.id, applicationId: application.id,
          removalId: removal.id, allocatedWetMassKg: 200, allocatedDryMassKg: 190,
        });
        return { batchId: batch.id, removalId: removal.id, applicationId: application.id };
      });
      chain.applicationIds.push(fixture.applicationId);

      const removalSlices = () => db.select().from(creditBatchApplications).where(and(
        eq(creditBatchApplications.organizationId, organizationId),
        eq(creditBatchApplications.removalId, fixture.removalId),
      ));
      expect(await removalSlices()).toHaveLength(1);
      expect(await db.select().from(certificationSubmissions).where(and(
        eq(certificationSubmissions.organizationId, organizationId),
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.localEntityId, fixture.removalId),
      ))).toHaveLength(0);

      await db.transaction((tx) => deleteCreditBatchApplicationSlices(ctx, tx, fixture.batchId));

      expect(await removalSlices()).toHaveLength(0);
      const remaining = await getCertifierRemovalById(ctx, fixture.removalId);
      if (marked) {
        expect(remaining).toMatchObject({
          id: fixture.removalId,
          metadata: { [REMOVAL_EXTERNAL_MUTATION_POSSIBLE_KEY]: true },
        });
      } else {
        expect(remaining).toBeNull();
      }
    } finally {
      // Dedicated organization: remove all test rows, including a kept Removal.
      await db.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, organizationId));
      await db.delete(creditBatches).where(eq(creditBatches.organizationId, organizationId));
      await db.delete(certifierRemovals).where(eq(certifierRemovals.organizationId, organizationId));
      await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, organizationId));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, organizationId));
      if (chain) await cleanupMutationFixture(chain);
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
});
