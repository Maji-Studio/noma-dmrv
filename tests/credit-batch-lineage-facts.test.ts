import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  creditBatchProductionRuns,
  creditBatches,
  customers,
  deliveries,
  facilities,
  feedstocks,
  feedstockTypes,
  orders,
  productionProcesses,
  productionRunFeedstocks,
  productionRuns,
  reactors,
} from "@/db/schema";
import { loadCreditBatchLineageFacts } from "@/data-access/credit-batch-lineage-facts";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCreditBatchChainData } from "@/data-access/chain-of-custody-batch";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("credit batch lineage facts", () => {
  it("keeps multi-application Roll-up projections aligned in three queries", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const ids: string[] = [];
    const [facility] = await db.insert(facilities).values({ organizationId: TEST_ORG_ID, code: `LF-F-${tag}`, name: `Lineage ${tag}` }).returning();
    const [reactor] = await db.insert(reactors).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `LF-R-${tag}`, identifier: `Lineage ${tag}`, reactorType: "fixed-bed" }).returning();
    const [feedstockType] = await db.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID, code: `LF-FT-${tag}`, name: `Lineage ${tag}`, category: "forestry" }).returning();
    const [process] = await db.insert(productionProcesses).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id }).returning();
    const runs = await db.insert(productionRuns).values([1, 2].map((n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, reactorId: reactor.id, code: `LF-PR${n}-${tag}`, startTime: new Date(`2026-07-0${n}T10:00:00Z`), biocharDryMassKg: 100 * n }))).returning();
    const stocks = await db.insert(feedstocks).values(runs.map((run, n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id, code: `LF-FS${n}-${tag}`, status: "complete" as const, massDryKg: 200, eligibilityStatus: "eligible" as const }))).returning();
    await db.insert(productionRunFeedstocks).values(runs.map((run, n) => ({ organizationId: TEST_ORG_ID, productionRunId: run.id, feedstockId: stocks[n].id, massUsedKg: 100 })));
    const products = await db.insert(biocharProducts).values(runs.map((run, n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `LF-BP${n}-${tag}`, linkedProductionRunId: run.id, massKg: 100 }))).returning();
    const [customer] = await db.insert(customers).values({ organizationId: TEST_ORG_ID, code: `LF-C-${tag}`, name: `Lineage ${tag}` }).returning();
    const ordersRows = await db.insert(orders).values(products.map((product, n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, customerId: customer.id, biocharProductId: product.id, code: `LF-O${n}-${tag}`, orderDate: new Date("2026-07-03"), quantityKg: 100, packaging: "loose" as const }))).returning();
    const deliveryRows = await db.insert(deliveries).values([
      { organizationId: TEST_ORG_ID, facilityId: facility.id, orderId: ordersRows[1].id, biocharProductId: products[0].id, code: `LF-D1-${tag}`, deliveryDate: new Date("2026-07-04"), deliveredWetMassKg: 10 },
      { organizationId: TEST_ORG_ID, facilityId: facility.id, orderId: ordersRows[1].id, code: `LF-D2-${tag}`, deliveryDate: new Date("2026-07-04"), deliveredWetMassKg: 20 },
    ]).returning();
    const appRows = await db.insert(applications).values(deliveryRows.map((delivery, n) => ({ organizationId: TEST_ORG_ID, deliveryId: delivery.id, code: `LF-A${n}-${tag}`, biocharAppliedTons: n + 1, biocharAppliedDryTons: n + 0.5 }))).returning();
    const [batch] = await db.insert(creditBatches).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id, productionProcessId: process.id, code: `LF-CB-${tag}`, startDate: "2026-07-01", endDate: "2026-07-31" }).returning();
    await db.insert(creditBatchProductionRuns).values(runs.map((run) => ({ organizationId: TEST_ORG_ID, creditBatchId: batch.id, productionRunId: run.id })));
    ids.push(...runs.map((r) => r.id), ...stocks.map((s) => s.id), ...products.map((p) => p.id), ...ordersRows.map((o) => o.id), ...deliveryRows.map((d) => d.id), ...appRows.map((a) => a.id));

    try {
      let queryCount = 0;
      const facts = (await loadCreditBatchLineageFacts(makeTestOrgContext(), [batch.id], db, { onQuery: () => queryCount++ }))[batch.id];
      const detail = await getCreditBatchById(makeTestOrgContext(), batch.id, { skipPreview: true });
      const chain = await getCreditBatchChainData(makeTestOrgContext(), batch.id);
      expect(queryCount).toBe(3);
      expect(facts.productionRunIds).toHaveLength(2);
      expect(facts.applicationIds).toHaveLength(2);
      expect(facts.appliedWeightTons).toBe(3);
      expect(
        facts.applications.find((application) => application.id === appRows[0].id)
          ?.biocharProduct.id,
      ).toBe(products[0].id);
      expect(
        facts.applications.find((application) => application.id === appRows[1].id)
          ?.biocharProduct.id,
      ).toBe(products[1].id);
      expect(detail?.applicationIds.sort()).toEqual(facts.applicationIds.sort());
      expect(detail?.productionRunIds.sort()).toEqual(facts.productionRunIds.sort());
      expect(detail?.appliedWeightTons).toBe(facts.appliedWeightTons);
      expect(chain.lineages.map((lineage) => lineage.applicationId).sort()).toEqual(facts.applicationIds.sort());
      expect(chain.sankey.columns.length).toBeGreaterThan(0);
    } finally {
      await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, batch.id));
      await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
      await db.delete(applications).where(inArray(applications.id, appRows.map((row) => row.id)));
      await db.delete(deliveries).where(inArray(deliveries.id, deliveryRows.map((row) => row.id)));
      await db.delete(orders).where(inArray(orders.id, ordersRows.map((row) => row.id)));
      await db.delete(biocharProducts).where(inArray(biocharProducts.id, products.map((row) => row.id)));
      await db.delete(productionRunFeedstocks).where(inArray(productionRunFeedstocks.productionRunId, runs.map((row) => row.id)));
      await db.delete(feedstocks).where(inArray(feedstocks.id, stocks.map((row) => row.id)));
      await db.delete(productionRuns).where(inArray(productionRuns.id, runs.map((row) => row.id)));
      await db.delete(productionProcesses).where(eq(productionProcesses.id, process.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
