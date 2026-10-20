import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deliveries, orders } from "@/db/schema";
import { cleanupOutputStockFixture } from "../../tests/helpers/output-stock-cleanup";
import { seedOutputStockParents } from "../../tests/helpers/output-stock-fixture";
import { getOrders } from "./orders";
import { getOrderStats } from "./order-stats";

const ORDER_COUNT = 25;
const PAGE_SIZE = 10;
const QUANTITY_KG = 100;
const DELIVERY_WET_KG = 10;
const EXTRA_DELIVERY_COUNT = 1;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

describe("getOrderStats whole-facility totals", () => {
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

    const orderValues = (owner: Fixture, code: string, facilityId = owner.facility.id) => ({
      organizationId: owner.ctx.organizationId,
      facilityId,
      code,
      customerId: owner.customer.id,
      customerLocationId: owner.location.id,
      formulationId: owner.recipe.id,
      orderDate: FIXTURE_DATE,
      quantityKg: QUANTITY_KG,
      packaging: "loose" as const,
    });
    const active = await db.insert(orders).values(Array.from({ length: ORDER_COUNT }, (_, index) =>
      orderValues(fixture, `E2E-ORDER-STATS-${fixture.tag}-${index}`),
    )).returning();
    const [archived] = await db.insert(orders).values({
      ...orderValues(fixture, `E2E-ORDER-ARCHIVED-${fixture.tag}`),
      archivedAt: FIXTURE_DATE,
    }).returning();
    const [otherOrder] = await db.insert(orders).values(
      orderValues(other, `E2E-ORDER-OTHER-${fixture.tag}`),
    ).returning();
    const [foreignOrder] = await db.insert(orders).values(
      orderValues(foreign, `E2E-ORDER-FOREIGN-${foreign.tag}`),
    ).returning();

    const deliveryValues = (order: typeof orders.$inferSelect, owner = fixture) => ({
      organizationId: owner.ctx.organizationId,
      facilityId: order.facilityId,
      orderId: order.id,
      code: `E2E-DELIVERY-STATS-${randomUUID()}`,
      deliveryDate: FIXTURE_DATE,
      storageLocationId: owner.bin.id,
      deliveredWetMassKg: DELIVERY_WET_KG,
    });
    await db.insert(deliveries).values([
      ...active.map((order) => deliveryValues(order)),
      deliveryValues(active[0]),
      { ...deliveryValues(active[0]), archivedAt: FIXTURE_DATE },
      deliveryValues(archived),
      deliveryValues(otherOrder, other),
      deliveryValues(foreignOrder, foreign),
    ]);
  });

  afterAll(async () => {
    if (foreign) await cleanupOutputStockFixture(db, foreign.ctx.organizationId);
    if (fixture) await cleanupOutputStockFixture(db, fixture.ctx.organizationId);
  });

  it("ignores list pagination and search and excludes archived, other-facility and foreign rows", async () => {
    const scope = { facilityId: fixture.facility.id };
    const expected = {
      totalOrders: ORDER_COUNT,
      totalDeliveries: ORDER_COUNT + EXTRA_DELIVERY_COUNT,
      totalQuantityKg: ORDER_COUNT * QUANTITY_KG,
    };
    expect(await getOrderStats(fixture.ctx, scope)).toEqual(expected);
    const page = await getOrders(fixture.ctx, { ...scope, page: 1, pageSize: PAGE_SIZE });
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.total).toBe(ORDER_COUNT);
    const searched = await getOrders(fixture.ctx, {
      ...scope, page: 1, pageSize: PAGE_SIZE,
      search: `E2E-ORDER-STATS-${fixture.tag}-0`,
    });
    expect(searched.items).toHaveLength(1);
    expect(await getOrderStats(fixture.ctx, scope)).toEqual(expected);
    const nextPage = await getOrders(fixture.ctx, { ...scope, page: 2, pageSize: PAGE_SIZE });
    expect(nextPage.items).toHaveLength(PAGE_SIZE);
    expect(await getOrderStats(fixture.ctx, scope)).toEqual(expected);
  });

  it("supports organization-wide totals and scopes even a foreign facility input", async () => {
    expect(await getOrderStats(fixture.ctx)).toEqual({
      totalOrders: ORDER_COUNT + 1,
      totalDeliveries: ORDER_COUNT + EXTRA_DELIVERY_COUNT + 1,
      totalQuantityKg: (ORDER_COUNT + 1) * QUANTITY_KG,
    });
    expect(await getOrderStats(fixture.ctx, { facilityId: otherFacilityId })).toEqual({
      totalOrders: 1, totalDeliveries: 1, totalQuantityKg: QUANTITY_KG,
    });
    expect(await getOrderStats(foreign.ctx, { facilityId: fixture.facility.id })).toEqual({
      totalOrders: 0, totalDeliveries: 0, totalQuantityKg: 0,
    });
  });
});
