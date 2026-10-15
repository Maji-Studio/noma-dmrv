import { randomUUID } from "node:crypto";
import { eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationOutputAllocations, biocharProducts, certifierProjects, creditBatchApplications, creditBatchProductionRuns, creditBatches, productionProcesses } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { createApiOrderReadFixture, insertReadDelivery, insertReadOrder, removeApiOrderReadFixture } from "./api-order-read-fixture";

export async function createApiApplicationReadFixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Application reads", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  const order = await insertReadOrder(f, `OR-AP-${f.tag}`);
  const delivery = await insertReadDelivery(f, order.id, 100.001);
  return { ...f, order, delivery, applicationKey: await key(["applications:read"]),
    applicationWriteKey: await key(["applications:write"]), deliveryKey: await key(["deliveries:read"]),
    deliveryWriteKey: await key(["deliveries:write"]) };
}
export type ApiApplicationReadFixture = Awaited<ReturnType<typeof createApiApplicationReadFixture>>;
export async function insertReadApplication(f: ApiApplicationReadFixture,
  values: Omit<Partial<typeof applications.$inferInsert>, "createdAt"> & { createdAt?: Date | SQL } = {}) {
  const [row] = await db.insert(applications).values({ organizationId: f.ctx.organizationId, code: `AP-READ-${randomUUID()}`,
    deliveryId: f.delivery.id, applicationDate: new Date("2026-09-15T00:00:00Z"),
    biocharAppliedTons: 0.025, biocharAppliedDryTons: 0.02, fieldSizeHa: 3, gpsLatitude: 1, gpsLongitude: 2, ...values }).returning();
  return row;
}
export async function removeApiApplicationReadFixture(f: ApiApplicationReadFixture) {
  for (const table of [creditBatchApplications, creditBatchProductionRuns, creditBatches, productionProcesses, certifierProjects]) {
    await db.delete(table).where(eq(table.organizationId, f.ctx.organizationId));
  }
  await removeApiOrderReadFixture(f);
}

export async function addReadApplicationAllocation(f: ApiApplicationReadFixture, application: typeof applications.$inferSelect) {
  const [product] = await db.insert(biocharProducts).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `BP-AP-${randomUUID()}`, formulationId: f.recipe.id, sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
    productionDate: new Date("2026-09-12"), placedAt: new Date("2026-09-12"), massKg: 100, moistureContentPercent: 20, waterAddedKg: 0 }).returning();
  await db.insert(applicationOutputAllocations).values({ organizationId: f.ctx.organizationId, applicationId: application.id,
    deliveryId: application.deliveryId, biocharProductId: product.id, productionRunId: f.runs[0].id, wetMassKg: "25.000", dryMassKg: "20.000" });
}
