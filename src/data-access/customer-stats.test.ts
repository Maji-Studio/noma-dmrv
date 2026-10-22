import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { customerLocations, customers } from "@/db/schema";
import { cleanupOutputStockFixture } from "../../tests/helpers/output-stock-cleanup";
import { seedOutputStockParents } from "../../tests/helpers/output-stock-fixture";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { getCustomers } from "./customers";
import { getCustomerStats } from "./customer-stats";

const CUSTOMER_COUNT = 25;
const PAGE_SIZE = 10;
const FIXTURE_CUSTOMER_COUNT = 1;
const FIXTURE_LOCATION_COUNT = 1;
const LOCATIONS_PER_CUSTOMER = 2;
const TOTAL_LOCATIONS = CUSTOMER_COUNT * LOCATIONS_PER_CUSTOMER + FIXTURE_LOCATION_COUNT;
const FIXTURE_DATE = new Date("2026-09-12T12:00:00Z");
type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

describe("getCustomerStats organization-wide totals", () => {
  let fixture: Fixture;
  let foreign: Fixture;

  beforeAll(async () => {
    fixture = await seedOutputStockParents(db);
    foreign = await seedOutputStockParents(db);

    const active = await db.insert(customers).values(
      Array.from({ length: CUSTOMER_COUNT - FIXTURE_CUSTOMER_COUNT }, (_, index) => ({
        organizationId: fixture.ctx.organizationId,
        code: `E2E-CUSTOMER-STATS-${fixture.tag}-${index}`,
        name: `E2E Customer stats ${fixture.tag} ${index}`,
      })),
    ).returning();
    const [archived] = await db.insert(customers).values({
      organizationId: fixture.ctx.organizationId,
      code: `E2E-CUSTOMER-ARCHIVED-${fixture.tag}`,
      name: `E2E Archived customer ${fixture.tag}`,
      archivedAt: FIXTURE_DATE,
    }).returning();
    const [foreignArchived] = await db.insert(customers).values({
      organizationId: foreign.ctx.organizationId,
      code: `E2E-CUSTOMER-ARCHIVED-${foreign.tag}`,
      name: `E2E Archived customer ${foreign.tag}`,
      archivedAt: FIXTURE_DATE,
    }).returning();

    const locationValues = (customer: typeof customers.$inferSelect, index: number, archived = false) => ({
      ...TEST_SITE_POSITION,
      organizationId: customer.organizationId,
      customerId: customer.id,
      name: `E2E Customer stats site ${customer.id} ${index} ${archived}`,
      country: "CH",
      archivedAt: archived ? FIXTURE_DATE : null,
    });
    // org-scope-ok: fixture insert; the values helper sets organizationId from the customer
    await db.insert(customerLocations).values([
      ...[fixture.customer, ...active, archived, foreignArchived].flatMap(customer => [
        ...Array.from({ length: LOCATIONS_PER_CUSTOMER }, (_, index) => locationValues(customer, index)),
        locationValues(customer, LOCATIONS_PER_CUSTOMER, true),
      ]),
      locationValues(foreign.customer, LOCATIONS_PER_CUSTOMER, true),
    ]);
  });

  afterAll(async () => {
    if (foreign) await cleanupOutputStockFixture(db, foreign.ctx.organizationId);
    if (fixture) await cleanupOutputStockFixture(db, fixture.ctx.organizationId);
  });

  it("totals all active customers and active locations independently of pagination and search", async () => {
    const expected = { totalCustomers: CUSTOMER_COUNT, totalLocations: TOTAL_LOCATIONS };
    expect(await getCustomerStats(fixture.ctx)).toEqual(expected);
    expect(await getCustomerStats(fixture.ctx, { archived: false })).toEqual(expected);
    const page = await getCustomers(fixture.ctx, { page: 1, pageSize: PAGE_SIZE });
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.total).toBe(CUSTOMER_COUNT);
    const searched = await getCustomers(fixture.ctx, {
      page: 1, pageSize: PAGE_SIZE,
      search: `E2E-CUSTOMER-STATS-${fixture.tag}-0`,
    });
    expect(searched.items).toHaveLength(1);
    expect(searched.total).toBe(1);
    expect(await getCustomerStats(fixture.ctx)).toEqual(expected);
    const nextPage = await getCustomers(fixture.ctx, { page: 2, pageSize: PAGE_SIZE });
    expect(nextPage.items).toHaveLength(PAGE_SIZE);
    expect(await getCustomerStats(fixture.ctx)).toEqual(expected);
    const allCustomers = await getCustomers(fixture.ctx, { page: 1, pageSize: CUSTOMER_COUNT });
    expect(allCustomers.items.reduce((total, customer) => total + customer.locationCount, 0)).toBe(TOTAL_LOCATIONS);
  });

  it("counts only active locations of customers in the requested archived state and organization", async () => {
    expect(await getCustomerStats(fixture.ctx, { archived: true })).toEqual({
      totalCustomers: 1, totalLocations: LOCATIONS_PER_CUSTOMER,
    });
    const archivedPage = await getCustomers(fixture.ctx, { archived: true, page: 1, pageSize: PAGE_SIZE });
    expect(archivedPage.total).toBe(1);
    expect(archivedPage.items[0].locationCount).toBe(LOCATIONS_PER_CUSTOMER);
    expect(await getCustomerStats(foreign.ctx)).toEqual({
      totalCustomers: FIXTURE_CUSTOMER_COUNT, totalLocations: FIXTURE_LOCATION_COUNT,
    });
    expect(await getCustomerStats(foreign.ctx, { archived: true })).toEqual({
      totalCustomers: 1, totalLocations: LOCATIONS_PER_CUSTOMER,
    });
  });
});
