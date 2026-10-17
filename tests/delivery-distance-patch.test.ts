import { customerLocationFacilityDistances } from "@/db/schema";
import { TEST_SITE_POSITION } from "./helpers/test-org";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { createDeliveryInTransaction, updateDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { getDeliveryWithRelations, getDeliveries } from "@/data-access/deliveries";
import { updateCustomerLocation } from "./helpers/customer-location-operations";
import { archiveFacility } from "@/data-access/facilities";
import { customerLocations, orders, transportLegs } from "@/db/schema";
import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";

const organizations: string[] = [];
afterEach(async () => {
  for (const id of organizations.splice(0)) {
    await cleanupOutputStockFixture(db, id);
  }
});
async function fixture() {
  const f = await createDeliveryFixture(); organizations.push(f.ctx.organizationId);
  const [location] = await db.insert(customerLocations).values({ ...TEST_SITE_POSITION, organizationId: f.ctx.organizationId, customerId: f.customer.id, name: "E2E Destination" }).returning();
  await db.insert(customerLocationFacilityDistances).values({ organizationId: f.ctx.organizationId, locationId: location.id, facilityId: f.facility.id, distanceKm: 20, distanceSource: "map_estimate" });
  await db.update(orders).set({ customerLocationId: location.id }).where(eq(orders.id, f.order.id));
  const created = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, distanceKmOverride: 30, distanceSource: "manual", distanceNote: "Route evidence" }));
  return { ...f, location, delivery: created.delivery };
}
describe("delivery distance PATCH", () => {
  it("keeps omitted values, clears override and source, and derives one-way legs", async () => {
    const f = await fixture();
    expect((await getDeliveryWithRelations(f.ctx, f.delivery.id)).effectiveDistanceKm).toBe(30);
    expect((await getDeliveries(f.ctx)).items.find(row => row.id === f.delivery.id)?.effectiveDistanceKm).toBe(30);
    expect(f.delivery).toMatchObject({ recordedDistanceKm: 20, recordedDistanceSource: "map_estimate" });
    await updateCustomerLocation(f.ctx, f.location.id, { expectedVersion: f.location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 80, distanceSource: "document" }] });
    let saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, f.delivery.id, { expectedVersion: f.delivery.version }));
    expect(saved).toMatchObject({ distanceKmOverride: 30, distanceSource: "manual", distanceNote: "Route evidence" });
    saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, saved.id, { expectedVersion: saved.version, distanceKmOverride: null }));
    expect(saved).toMatchObject({ distanceKmOverride: null, distanceSource: null, distanceNote: "Route evidence" });
    const legs = await db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId));
    expect(legs).toHaveLength(1);
    expect(legs[0].distanceKm).toBe(20);
    expect(countedRoundTripKm(legs[0].distanceKm!)).toBe(40);
    saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, saved.id, { expectedVersion: saved.version, distanceKmOverride: 40 }));
    expect(saved).toMatchObject({ distanceKmOverride: 40, distanceSource: "manual" });
  });
  it("keeps the frozen route when an unrelated form edit sends a null source", async () => {
    const f = await fixture();
    const cleared = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, f.delivery.id,
      { expectedVersion: f.delivery.version, distanceKmOverride: null }));
    await updateCustomerLocation(f.ctx, f.location.id, { expectedVersion: f.location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 80, distanceSource: "document" }] });
    const saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, cleared.id,
      { expectedVersion: cleared.version, code: `E2E-EDIT-${f.tag}`, distanceSource: null }));
    expect(saved).toMatchObject({ recordedDistanceKm: 20, recordedDistanceSource: "map_estimate", distanceKmOverride: null });
    expect((await getDeliveryWithRelations(f.ctx, saved.id)).effectiveDistanceKm).toBe(20);
  });
  it("supports source-only patches and documentary provenance without an override", async () => {
    const f = await fixture();
    let saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, f.delivery.id, { expectedVersion: f.delivery.version, distanceSource: "document" }));
    expect(saved).toMatchObject({ distanceKmOverride: 30, distanceSource: "document", recordedDistanceKm: 20, recordedDistanceSource: "map_estimate" });
    saved = await db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, saved.id, { expectedVersion: saved.version, distanceKmOverride: null, distanceSource: "document" }));
    expect(saved).toMatchObject({ distanceKmOverride: null, distanceSource: "document" });
    await expect(db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, saved.id, { expectedVersion: saved.version, distanceKmOverride: 0 }))).rejects.toThrow("Distance must be greater than 0");
  });
  it("refuses an archived delivery with not_found", async () => {
    const f = await fixture();
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    await expect(db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, f.delivery.id, { expectedVersion: f.delivery.version, distanceNote: "Changed" }))).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["deliveryId"] }] });
  });
});
