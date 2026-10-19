import { randomUUID } from "node:crypto";
import { and, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, members, orders } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { cleanupOrderFixture, createOrderFixture, type OrderFixture } from "./order-operation-fixture";

export const READ_TIMEOUT_MS = 60_000;
export const READ_ORDER_KG = 100;
export const READ_ORDER_DAY = "2026-09-12";
export const READ_ARCHIVE_AT = new Date("2026-10-01T00:00:00Z");
export const UNKNOWN_READ_ID = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";

export async function createApiOrderReadFixture() {
  const f = await createOrderFixture();
  await db.insert(members).values({ id: randomUUID(), organizationId: f.ctx.organizationId, userId: f.ctx.userId, role: "owner" });
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Order read fixture", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, key: await key(["customers:read", "orders:read", "storage-locations:read"]),
    customerKey: await key(["customers:read"]), orderKey: await key(["orders:read"]), writeOnlyKey: await key(["orders:write"]), missingScopeKey: await key(["feedstocks:read"]) };
}
export type ApiOrderReadFixture = Awaited<ReturnType<typeof createApiOrderReadFixture>>;
export const removeApiOrderReadFixture = cleanupOrderFixture;
export const readRequest = (path: string, key: string) => new Request(`http://localhost:3100/api/v1${path}`, { headers: { authorization: `Bearer ${key}` } });
export const readParams = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });

export async function insertReadOrder(f: OrderFixture, code: string, values: Omit<Partial<typeof orders.$inferInsert>, "createdAt"> & { createdAt?: Date | SQL } = {}) {
  const [row] = await db.insert(orders).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    customerId: f.customer.id, customerLocationId: f.location.id, formulationId: f.recipe.id, code,
    orderDate: new Date(`${READ_ORDER_DAY}T00:00:00Z`), quantityKg: READ_ORDER_KG, packaging: "loose", ...values }).returning();
  return row;
}

export async function insertReadDelivery(f: OrderFixture, orderId: string, massKg: number, archived = false) {
  const [row] = await db.insert(deliveries).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    orderId, code: `E2E-READ-D-${randomUUID()}`, storageLocationId: f.bin.id,
    deliveryDate: new Date("2026-09-14T12:00:00Z"), deliveredWetMassKg: massKg, massDryKg: massKg,
    archivedAt: archived ? READ_ARCHIVE_AT : null }).returning();
  return row;
}

export async function archiveReadOrder(f: OrderFixture, orderId: string) {
  await db.update(orders).set({ archivedAt: READ_ARCHIVE_AT }).where(and(eq(orders.organizationId, f.ctx.organizationId), eq(orders.id, orderId)));
}
