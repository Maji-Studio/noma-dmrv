import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBiocharProducts } from "@/data-access/biochar-products";
import { db } from "@/db";
import {
  biocharProducts, biocharProductSourceAllocations, creditBatchProductionRuns,
  creditBatches, facilities, feedstockTypes, formulations, organizations,
  productionProcesses, productionRuns, reactors, storageLocations,
} from "@/db/schema";
import { outputProductFixtureValues } from "./helpers/output-contract-fixtures";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const MASS_KG = 100;
const BATCH_WINDOWS = [
  { label: "A", startDate: "2025-01-01", endDate: "2025-01-15" },
  { label: "B", startDate: "2025-01-16", endDate: "2025-01-31" },
] as const;
const PROCESS_ESTABLISHED_AT = new Date("2025-01-01T00:00:00Z");

describe("biochar product credit batch filter (real database)", () => {
  const organizationId = `org_product_batch_filter_${randomUUID()}`;
  const org = { organizationId };
  const ctx = { ...makeTestOrgContext(), organizationId };
  const members: { batchId: string; productId: string }[] = [];

  beforeAll(async () => {
    await db.insert(organizations).values({
      id: organizationId, name: "E2E Product batch filter", slug: organizationId,
    });
    const tag = randomUUID();
    const [facility] = await db.insert(facilities).values({
      ...org, ...TEST_SITE_POSITION, timezone: "UTC",
      code: `E2E-FAC-${tag}`, name: "E2E Product batch filter facility",
    }).returning();
    const [type] = await db.insert(feedstockTypes).values({
      ...org, code: `E2E-FT-${tag}`, name: "E2E Product batch filter feedstock",
      category: "forestry", usage: "pyrolysis",
    }).returning();
    const [process] = await db.insert(productionProcesses).values({
      ...org, facilityId: facility.id, feedstockTypeId: type.id,
      establishedAt: PROCESS_ESTABLISHED_AT,
    }).returning();
    const [reactor] = await db.insert(reactors).values({
      ...org, facilityId: facility.id, code: `E2E-RE-${tag}`,
      identifier: "E2E Product batch filter reactor", reactorType: "auger",
    }).returning();
    // Both products share the source bin; only saved run allocations establish lineage.
    const [outputBin] = await db.insert(storageLocations).values({
      ...org, facilityId: facility.id, type: "biochar_bin",
      code: `E2E-OUT-${tag}`, name: "E2E Product batch filter output",
    }).returning();

    for (const window of BATCH_WINDOWS) {
      const [batch] = await db.insert(creditBatches).values({
        ...org, facilityId: facility.id, feedstockTypeId: type.id,
        productionProcessId: process.id, code: `E2E-CB-${window.label}-${tag}`,
        startDate: window.startDate, endDate: window.endDate,
      }).returning();
      const endTime = new Date(`${window.startDate}T09:00:00Z`);
      const [run] = await db.insert(productionRuns).values({
        ...org, facilityId: facility.id, reactorId: reactor.id,
        code: `E2E-PR-${window.label}-${tag}`, status: "complete",
        startTime: new Date(`${window.startDate}T08:00:00Z`), endTime,
        biocharStorageLocationId: outputBin.id, biocharOutputKg: MASS_KG,
        biocharDryMassKg: MASS_KG, biocharMoisturePercent: 0,
      }).returning();
      await db.insert(creditBatchProductionRuns).values({
        ...org, creditBatchId: batch.id, productionRunId: run.id,
      });
      const [product] = await db.insert(biocharProducts).values(
        await outputProductFixtureValues(db, {
          ...org, facilityId: facility.id, code: `E2E-BP-${window.label}-${tag}`,
          linkedProductionRunId: run.id, placedAt: endTime, massKg: MASS_KG,
        }),
      ).returning();
      await db.insert(biocharProductSourceAllocations).values({
        ...org, biocharProductId: product.id, productionRunId: run.id,
        sourceStorageLocationId: outputBin.id,
        allocatedDryMassKg: MASS_KG, allocatedWetMassKg: MASS_KG,
      });
      members.push({ batchId: batch.id, productId: product.id });
    }
  });

  afterAll(async () => {
    // Include fixture-created bins and formulations, all in this suite's private org.
    for (const table of [
      biocharProductSourceAllocations, biocharProducts, creditBatchProductionRuns,
      productionRuns, creditBatches, productionProcesses, storageLocations,
      reactors, facilities, feedstockTypes, formulations,
    ]) {
      await db.delete(table).where(eq(table.organizationId, organizationId));
    }
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  });

  it("returns only the product whose source run belongs to each selected batch", async () => {
    const unfiltered = await getBiocharProducts(ctx);
    expect(unfiltered.items.map(product => product.id).sort())
      .toEqual(members.map(member => member.productId).sort());
    expect(unfiltered.total).toBe(members.length);

    for (const member of members) {
      const result = await getBiocharProducts(ctx, { creditBatchId: member.batchId });
      expect(result.items.map(product => product.id)).toEqual([member.productId]);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    }
  });
});
