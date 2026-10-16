import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, customers, customerLocations, customerLocationFacilityDistances, facilities, feedstocks, members, orders,
  suppliers, supplierLocations, supplierLocationFacilityDistances, users } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { createFeedstockType } from "@/data-access/feedstock-types";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { archiveSupplier, createSupplier } from "@/lib/operations/suppliers";
import { archiveCustomer, createCustomer } from "@/lib/operations/customers";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createIntakeFixture, type IntakeFixture } from "../../tests/helpers/operation-fixture";
import { PARTY_CASES, PARTY_CUSTOMER_NAME, PARTY_PICKUP, PARTY_SUPPLIER_NAME, type PartyCaseId } from "./config";
import { cleanupDeliveryFixture } from "./fixture-delivery";
import type { PartyRow, PartySnapshot, PartyTarget } from "./score-parties";

const scriptOptions = { activitySource: "script" as const };
export interface PartyEvalFixture extends IntakeFixture { key: string; target: PartyTarget }
export async function seedPartyFixture(caseId: PartyCaseId): Promise<PartyEvalFixture> {
  const fixture = await db.transaction(tx => createIntakeFixture(`eval-${caseId}-${randomUUID()}`, tx));
  const { ctx } = fixture;
  try {
    await db.insert(users).values({ id: ctx.userId, email: `${ctx.userId}@example.test`, name: "MCP evaluation", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: ctx.organizationId, userId: ctx.userId, role: "owner" });
    const [facility] = await db.select().from(facilities).where(eq(facilities.organizationId, ctx.organizationId));
    const locations = [{ name: "Existing pickup", country: "Tanzania", gpsLatitude: PARTY_PICKUP.gpsLatitude, gpsLongitude: PARTY_PICKUP.gpsLongitude }];
    let partyId = "";
    let name = PARTY_SUPPLIER_NAME;
    if (caseId !== "supplier-with-pickup" && caseId !== "customer-and-field" && caseId !== "customer-restore") {
      const { supplier } = await runOperationInProcess(createSupplier, ctx, { name, locations }, scriptOptions);
      partyId = supplier.id;
      if (caseId !== "supplier-already-exists") await runOperationInProcess(archiveSupplier, ctx, { supplierId: partyId, expectedVersion: supplier.version }, scriptOptions);
    }
    if (caseId === "customer-restore") {
      name = PARTY_CUSTOMER_NAME;
      const { customer } = await runOperationInProcess(createCustomer, ctx, { name, locations }, scriptOptions);
      partyId = customer.id;
      await runOperationInProcess(archiveCustomer, ctx, { customerId: partyId, expectedVersion: customer.version }, scriptOptions);
    }
    if (caseId === "supplier-archived-intake") {
      await createFeedstockType(ctx, { code: "RICE", name: "Rice husk", category: "agricultural", usage: "pyrolysis" });
    }
    const definition = PARTY_CASES.find(({ id }) => id === caseId)!;
    const credential = await createApiKey(ctx, { name: "MCP evaluation", scopes: [...definition.scopes], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    return { ...fixture, key: credential.key, target: {
      partyId, name, facilityId: facility.id, facilityName: facility.name, before: await readPartySnapshot(fixture),
    } };
  } catch (error) {
    try { await cleanupPartyFixture(fixture); }
    catch { /* Preserve the original seeding error if cleanup also fails. */ }
    throw error;
  }
}

/** Full org-scoped facts, sorted by id so existing-row comparisons are stable. */
export async function readPartySnapshot({ ctx }: IntakeFixture): Promise<PartySnapshot> {
  const org = ctx.organizationId;
  const rows = await Promise.all([
    db.select().from(suppliers).where(eq(suppliers.organizationId, org)).orderBy(suppliers.id),
    db.select().from(customers).where(eq(customers.organizationId, org)).orderBy(customers.id),
    db.select().from(supplierLocations).where(eq(supplierLocations.organizationId, org)).orderBy(supplierLocations.id),
    db.select().from(customerLocations).where(eq(customerLocations.organizationId, org)).orderBy(customerLocations.id),
    db.select().from(supplierLocationFacilityDistances).where(eq(supplierLocationFacilityDistances.organizationId, org)).orderBy(supplierLocationFacilityDistances.id),
    db.select().from(customerLocationFacilityDistances).where(eq(customerLocationFacilityDistances.organizationId, org)).orderBy(customerLocationFacilityDistances.id),
    db.select().from(feedstocks).where(eq(feedstocks.organizationId, org)).orderBy(feedstocks.id),
    db.select().from(orders).where(eq(orders.organizationId, org)).orderBy(orders.id),
    db.select({ entityType: activityEvents.entityType, entityId: activityEvents.entityId, action: activityEvents.action,
      versionBefore: activityEvents.versionBefore, versionAfter: activityEvents.versionAfter,
      fromStatus: activityEvents.fromStatus, toStatus: activityEvents.toStatus,
    }).from(activityEvents).where(eq(activityEvents.organizationId, org)),
  ]);
  const [supplierRows, customerRows, supplierSites, customerSites, supplierPairs, customerPairs, intakes, orderRows, activity] = rows;
  // JSON normalizes dates exactly as the saved report does.
  const serialize = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const partyRows = (values: (typeof supplierRows[number] | typeof customerRows[number])[]): PartyRow[] => values.map(row => ({
    ...row, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }));
  return serialize({ suppliers: partyRows(supplierRows), customers: partyRows(customerRows),
    supplierLocations: supplierSites, customerLocations: customerSites, supplierDistances: supplierPairs, customerDistances: customerPairs,
    feedstocks: intakes, orders: orderRows, activity });
}
export async function cleanupPartyFixture(fixture: IntakeFixture): Promise<void> {
  // Supplier locations block the intake helper's supplier delete; distance pairs cascade.
  await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, fixture.ctx.organizationId));
  await cleanupDeliveryFixture(fixture);
}
