import { TEST_SITE_POSITION } from "./test-org";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, customerLocations, customers, facilities, documents, organizationSettings, storageObjectDeletions } from "@/db/schema";
import { cleanupOutputStockFixture } from "./output-stock-cleanup";
import { seedOutputStockParents } from "./output-stock-fixture";

export const ORDER_DAY = "2026-09-12";
export const ORDER_WET_KG = 100;
export async function createOrderFixture() {
  const f = await seedOutputStockParents(db);
  const [otherCustomer] = await db.insert(customers).values({ organizationId: f.ctx.organizationId,
    code: `E2E-OC-${f.tag}`, name: `E2E Other ${f.tag}` }).returning();
  const [otherFacility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: f.ctx.organizationId,
    code: `E2E-OF-${f.tag}`, name: `E2E Other ${f.tag}`, timezone: "UTC" }).returning();
  return { ...f, otherCustomer, otherFacility };
}
export type OrderFixture = Awaited<ReturnType<typeof createOrderFixture>>;
export async function createOrderDestination(f: OrderFixture, customerId = f.customer.id) {
  const [location] = await db.insert(customerLocations).values({ ...TEST_SITE_POSITION, country: "CH", organizationId: f.ctx.organizationId,
    customerId, name: `E2E Other site ${f.tag}`, }).returning();
  return location;
}
export function orderInput(f: OrderFixture, changes: Record<string, unknown> = {}) {
  return { facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: f.location.id,
    formulationId: f.recipe.id, orderDate: ORDER_DAY, quantityKg: ORDER_WET_KG, ...changes };
}
export async function cleanupOrderFixture(f: OrderFixture) {
  const id = f.ctx.organizationId;
  await db.delete(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, id));
  await db.delete(documents).where(eq(documents.organizationId, id));
  await db.delete(activityEvents).where(eq(activityEvents.organizationId, id));
  await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, id));
  await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, id));
  await cleanupOutputStockFixture(db, id);
}
