import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { applications, deliveries, orders } from "@/db/schema";
import { cleanupOutputStockFixture } from "../../tests/helpers/output-stock-cleanup";
import { seedOutputStockParents } from "../../tests/helpers/output-stock-fixture";
import { getApplications } from "./applications";
import { getApplicationStats } from "./application-stats";

const APPLICATION_COUNT = 25;
const PAGE_SIZE = 10;
const APPLIED_MICROTONNES = 100001;
const MICROTONNES_PER_TONNE = 1_000_000;
const APPLIED_TONS = APPLIED_MICROTONNES / MICROTONNES_PER_TONNE;
const APPLIED_DRY_TONS = 0.08;
const FIELD_SIZE_HA = 3;
const DELIVERY_WET_KG = 10_000;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
const totalTons = (count: number) => count * APPLIED_MICROTONNES / MICROTONNES_PER_TONNE;
type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

describe("getApplicationStats whole-facility totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;
  let otherFacilityId: string;

  beforeAll(async () => {
    fixture = await seedOutputStockParents(db);
    const other = await seedOutputStockParents(db, {
      organizationId: fixture.ctx.organizationId,
      userId: fixture.ctx.userId,
    });
    otherFacilityId = other.facility.id;
    foreign = await seedOutputStockParents(db);

    const insertDelivery = async (owner: Fixture, archived = false) => {
      const [order] = await db.insert(orders).values({
        organizationId: owner.ctx.organizationId,
        facilityId: owner.facility.id,
        code: `E2E-APPLICATION-STATS-ORDER-${owner.tag}-${archived}`,
        customerId: owner.customer.id,
        customerLocationId: owner.location.id,
        formulationId: owner.recipe.id,
        orderDate: FIXTURE_DATE,
        quantityKg: DELIVERY_WET_KG,
        packaging: "loose",
      }).returning();
      const [delivery] = await db.insert(deliveries).values({
        organizationId: owner.ctx.organizationId,
        facilityId: owner.facility.id,
        orderId: order.id,
        code: `E2E-APPLICATION-STATS-DELIVERY-${owner.tag}-${archived}`,
        deliveryDate: FIXTURE_DATE,
        storageLocationId: owner.bin.id,
        deliveredWetMassKg: DELIVERY_WET_KG,
        archivedAt: archived ? FIXTURE_DATE : null,
      }).returning();
      return delivery;
    };
    const activeDelivery = await insertDelivery(fixture);
    const archivedDelivery = await insertDelivery(fixture, true);
    const otherDelivery = await insertDelivery(other);
    const foreignDelivery = await insertDelivery(foreign);

    const applicationValues = (delivery: typeof deliveries.$inferSelect, code: string) => ({
      organizationId: delivery.organizationId,
      deliveryId: delivery.id,
      code,
      applicationDate: FIXTURE_DATE,
      biocharAppliedTons: APPLIED_TONS,
      biocharAppliedDryTons: APPLIED_DRY_TONS,
      fieldSizeHa: FIELD_SIZE_HA,
    });
    // org-scope-ok: fixture insert; the values helper sets organizationId from the delivery
    await db.insert(applications).values([
      ...Array.from({ length: APPLICATION_COUNT }, (_, index) =>
        applicationValues(activeDelivery, `E2E-APPLICATION-STATS-${fixture.tag}-${index}`),
      ),
      applicationValues(archivedDelivery, `E2E-APPLICATION-ARCHIVED-${fixture.tag}`),
      applicationValues(otherDelivery, `E2E-APPLICATION-OTHER-${other.tag}`),
      applicationValues(foreignDelivery, `E2E-APPLICATION-FOREIGN-${foreign.tag}`),
    ]);
  });

  afterAll(async () => {
    if (foreign) await cleanupOutputStockFixture(db, foreign.ctx.organizationId);
    if (fixture) await cleanupOutputStockFixture(db, fixture.ctx.organizationId);
  });

  it("totals every facility application independently of pagination and search", async () => {
    const scope = { facilityId: fixture.facility.id };
    const expected = {
      totalApplications: APPLICATION_COUNT,
      totalBiocharAppliedTons: totalTons(APPLICATION_COUNT),
    };
    expect(await getApplicationStats(fixture.ctx, scope)).toEqual(expected);
    const page = await getApplications(fixture.ctx, { ...scope, page: 1, pageSize: PAGE_SIZE });
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.total).toBe(APPLICATION_COUNT);
    const searched = await getApplications(fixture.ctx, {
      ...scope, page: 1, pageSize: PAGE_SIZE,
      search: `E2E-APPLICATION-STATS-${fixture.tag}-0`,
    });
    expect(searched.items).toHaveLength(1);
    expect(searched.total).toBe(1);
    expect(await getApplicationStats(fixture.ctx, scope)).toEqual(expected);
    const nextPage = await getApplications(fixture.ctx, { ...scope, page: 2, pageSize: PAGE_SIZE });
    expect(nextPage.items).toHaveLength(PAGE_SIZE);
    expect(await getApplicationStats(fixture.ctx, scope)).toEqual(expected);
  });

  it("includes other facilities only for org totals and excludes archived deliveries and foreign rows", async () => {
    expect(await getApplicationStats(fixture.ctx)).toEqual({
      totalApplications: APPLICATION_COUNT + 1,
      totalBiocharAppliedTons: totalTons(APPLICATION_COUNT + 1),
    });
    expect(await getApplicationStats(fixture.ctx, { facilityId: otherFacilityId })).toEqual({
      totalApplications: 1, totalBiocharAppliedTons: APPLIED_TONS,
    });
    expect(await getApplicationStats(foreign.ctx)).toEqual({
      totalApplications: 1, totalBiocharAppliedTons: APPLIED_TONS,
    });
    expect(await getApplicationStats(foreign.ctx, { facilityId: fixture.facility.id })).toEqual({
      totalApplications: 0, totalBiocharAppliedTons: 0,
    });
  });
});
