import { and, eq, notExists } from "drizzle-orm";
import { db } from "@/db";
import { certifierProjects, certifierStorageLocations, feedstocks, productionRunFeedstocks, supplierLocations, suppliers } from "@/db/schema";
import { createOrderFixture, cleanupOrderFixture } from "./order-operation-fixture";

export async function createPartyArchiveFixture() {
  const f = await createOrderFixture();
  const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, intake.supplierId));
  return { ...f, supplier, intake };
}
export type PartyArchiveFixture = Awaited<ReturnType<typeof createPartyArchiveFixture>>;
export async function cleanupPartyArchiveFixture(f: PartyArchiveFixture) {
  const organizationId = f.ctx.organizationId;
  await db.delete(certifierStorageLocations).where(eq(certifierStorageLocations.organizationId, organizationId));
  await db.delete(certifierProjects).where(eq(certifierProjects.organizationId, organizationId));
  await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, organizationId));
  // Remove new intakes first; the original fixture's run-linked intake stays for
  // the shared cleanup, which owns its draws and generated supplier.
  await db.delete(feedstocks).where(and(eq(feedstocks.organizationId, organizationId), notExists(
    db.select({ id: productionRunFeedstocks.id }).from(productionRunFeedstocks).where(eq(productionRunFeedstocks.feedstockId, feedstocks.id)),
  )));
  await db.delete(suppliers).where(and(eq(suppliers.organizationId, organizationId), notExists(
    db.select({ id: feedstocks.id }).from(feedstocks).where(eq(feedstocks.supplierId, suppliers.id)),
  )));
  await cleanupOrderFixture(f);
}
export function partyIntakeInput(f: PartyArchiveFixture, supplierId = f.supplier.id) {
  return { facilityId: f.facility.id, supplierId, feedstockTypeId: f.intake.feedstockTypeId,
    deliveryDate: "2026-09-12", totalWetMassKg: 100, moisturePercent: 10,
    allocations: [{ storageLocationId: f.intake.storageLocationId, allocatedWetMassKg: 100 }] };
}
