import { randomUUID } from "node:crypto";
import { and, eq, inArray, notExists } from "drizzle-orm";
import type { db, DbTransaction } from "@/db";
import { feedstocks, storageLocations, suppliers } from "@/db/schema";

type Executor = typeof db | DbTransaction;
type Values = typeof feedstocks.$inferInsert;
type IntakeFields = "supplierId" | "storageLocationId" | "deliveryDate" | "massWetKg" | "moistureContentPercent";
type Fixture = Omit<Values, IntakeFields> & Partial<Pick<Values, IntakeFields>>;
const FIXTURE_DELIVERY_DATE = new Date("2025-01-01T00:00:00.000Z");
const PERCENT = 100;
const ownedBins = new Set<string>();
const ownedSuppliers = new Set<string>();

/** Supply real intake parents for tests whose subject is downstream of intake. */
async function completeIntake(executor: Executor, input: Fixture): Promise<Values> {
  let supplierId = input.supplierId;
  if (!supplierId) {
    const [supplier] = await executor.insert(suppliers).values({
      organizationId: input.organizationId, code: `E2E-INTAKE-${randomUUID()}`,
      name: `E2E Intake supplier ${randomUUID()}`,
    }).returning();
    supplierId = supplier.id;
    ownedSuppliers.add(supplierId);
  }
  let storageLocationId = input.storageLocationId;
  if (!storageLocationId) {
    const [bin] = await executor.insert(storageLocations).values({
      organizationId: input.organizationId, facilityId: input.facilityId,
      code: `E2E-INTAKE-${randomUUID()}`, name: `E2E Intake bin ${randomUUID()}`, type: "feedstock_bin",
      feedstockTypeId: input.feedstockTypeId,
    }).returning();
    storageLocationId = bin.id;
    ownedBins.add(storageLocationId);
  }
  const moistureContentPercent = input.moistureContentPercent ?? 0;
  return { ...input, supplierId, storageLocationId, moistureContentPercent,
    massWetKg: input.massWetKg ?? input.massDryKg / (1 - moistureContentPercent / PERCENT),
    deliveryDate: input.deliveryDate ?? FIXTURE_DELIVERY_DATE };
}

export function feedstockFixtureValues(executor: Executor, input: Fixture): Promise<Values>;
export function feedstockFixtureValues(executor: Executor, input: Fixture[]): Promise<Values[]>;
export async function feedstockFixtureValues(executor: Executor, input: Fixture | Fixture[]) {
  return Array.isArray(input)
    ? Promise.all(input.map(row => completeIntake(executor, row)))
    : completeIntake(executor, input);
}

/** Call after removing fixture intakes, before deleting their types or facilities. */
export async function cleanupFeedstockFixtureParents(executor: Executor) {
  if (ownedBins.size) {
    const removed = await executor.delete(storageLocations).where(and(
      inArray(storageLocations.id, [...ownedBins]),
      notExists(executor.select({ id: feedstocks.id }).from(feedstocks).where(eq(feedstocks.storageLocationId, storageLocations.id))),
    )).returning({ id: storageLocations.id });
    for (const row of removed) ownedBins.delete(row.id);
  }
  if (ownedSuppliers.size) {
    const removed = await executor.delete(suppliers).where(and(
      inArray(suppliers.id, [...ownedSuppliers]),
      notExists(executor.select({ id: feedstocks.id }).from(feedstocks).where(eq(feedstocks.supplierId, suppliers.id))),
    )).returning({ id: suppliers.id });
    for (const row of removed) ownedSuppliers.delete(row.id);
  }
}
