import { apiActivityWhere, apiAuditColumns, toApiAuditRow } from "../../tests/helpers/api-activity";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents, binMovements, biocharProducts, biocharProductSourceAllocations, customerLocations, customers,
  deliveries, facilities, formulationIngredients, formulations, members, orders, outputStockAllocations,
  outputStockMoistureReadings, outputStockRunAllocations, productIngredientSnapshots, productionRuns, transportLegs, users,
} from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { createCustomer, createCustomerLocation } from "@/data-access/customers";
import { createFormulation } from "@/data-access/formulations";
import { createOrderInTransaction } from "@/data-access/orders";
import { createStorageLocation } from "@/data-access/storage-locations";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { addDaysIso, combineDateAndTime, formatFacilityDate } from "@/lib/date-utils";
import { addFixtureReactor, createIntakeFixture, type IntakeFixture } from "../../tests/helpers/operation-fixture";
import { cleanupFixture } from "./fixture";
import { DELIVERY_BIN_CODE, DELIVERY_ORDER_CODE, DELIVERY_SPLIT_BIN_CODE, FACILITY_TIME_ZONE, type DeliveryCaseId } from "./config";
import { deliveryDays, type DeliveryDatabaseSnapshot, type DeliveryTarget } from "./score-delivery";

const DELIVERY_SCOPES = ["deliveries:read", "deliveries:write", "orders:read", "customers:read",
  "storage-locations:read", "facilities:read", "formulations:read", "biochar-products:read"];
const CUSTOMER_CODE = "CUS-X";
const FORMULATION_CODE = "FM-X";
const SOURCE_BIN_CODE = "BC-1";
const SOURCE_RUN_CODE = "PR-X";
const LOCATION_DISTANCE_KM = 18;
const ORDER_QUANTITY_KG = 20_000;
const SOURCE_WET_KG = 30_000;
const SOURCE_DRY_KG = 27_000;
const SOURCE_MOISTURE_PERCENT = 10;
const SOURCE_DAYS_AGO = 4;
const SOURCE_START_TIME = "08:00";
const SOURCE_END_TIME = "12:00";
const PRODUCT_PLACEMENT_TIME = "12:00";
const MIX_PRODUCT = { code: "BP-1", wetKg: 10_000, moisturePercent: 10, daysAgo: 3 };
const SPLIT_PRODUCTS = [
  { code: "BP-2", wetKg: 5000, moisturePercent: 20, daysAgo: 2 },
  { code: "BP-3", wetKg: 5000, moisturePercent: 40, daysAgo: 1 },
] as const;
const PURE_BIOCHAR_RATIO = 1;
const WATER_ADDED_KG = 0;

export interface DeliveryEvalFixture extends IntakeFixture {
  key: string;
  target: Omit<DeliveryTarget, "deliveryDays">;
  customer: { id: string; code: string };
  locationId: string;
  formulation: { id: string; code: string };
  mixBin: { id: string; code: string };
  splitBin: { id: string; code: string } | null;
  products: { id: string; code: string }[];
  seededMovementIds: string[];
}

/** Seed upstream production facts like the stock fixture; post products and create the order through real writers. */
export async function seedDeliveryFixture(caseId: DeliveryCaseId, now = new Date(), scopes = DELIVERY_SCOPES, timeZone = FACILITY_TIME_ZONE): Promise<DeliveryEvalFixture> {
  const fixture = await db.transaction((tx) => createIntakeFixture(`eval-${caseId}-${randomUUID()}`, tx));
  const org = fixture.ctx.organizationId;
  const today = formatFacilityDate(now, timeZone);
  const localInstant = (daysAgo: number, time: string) => combineDateAndTime(addDaysIso(today, -daysAgo), time, timeZone);
  try {
    await db.insert(users).values({ id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`, name: "MCP evaluation", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: org, userId: fixture.ctx.userId, role: "owner" });
    await db.update(facilities).set({ timezone: timeZone, archivedAt: null })
      .where(and(eq(facilities.organizationId, org), eq(facilities.id, fixture.facilityId)));
    const customer = await createCustomer(fixture.ctx, { code: CUSTOMER_CODE, name: "Evaluation customer" });
    const location = await createCustomerLocation(fixture.ctx, { ...TEST_SITE_POSITION, customerId: customer.id, name: "Evaluation destination",
      isDefault: true, facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: LOCATION_DISTANCE_KM, distanceSource: "manual" }] });
    const formulation = await createFormulation(fixture.ctx, { code: FORMULATION_CODE, name: "Evaluation pure biochar", biocharRatio: PURE_BIOCHAR_RATIO });
    const source = await createStorageLocation(fixture.ctx, { code: SOURCE_BIN_CODE, name: SOURCE_BIN_CODE,
      facilityId: fixture.facilityId, type: "biochar_bin", stockMode: "mix" });
    const mixBin = await createStorageLocation(fixture.ctx, { code: DELIVERY_BIN_CODE, name: DELIVERY_BIN_CODE,
      facilityId: fixture.facilityId, type: "product_bin", stockMode: "mix", formulationId: formulation.id });
    const reactorId = await addFixtureReactor(fixture, caseId);
    await db.insert(productionRuns).values({ organizationId: org, facilityId: fixture.facilityId, reactorId,
      code: SOURCE_RUN_CODE, status: "complete", startTime: localInstant(SOURCE_DAYS_AGO, SOURCE_START_TIME),
      endTime: localInstant(SOURCE_DAYS_AGO, SOURCE_END_TIME), biocharStorageLocationId: source.id,
      biocharOutputKg: SOURCE_WET_KG, biocharMoisturePercent: SOURCE_MOISTURE_PERCENT, biocharDryMassKg: SOURCE_DRY_KG });
    const place = (binId: string, product: typeof MIX_PRODUCT) => createBiocharProduct(fixture.ctx, {
      code: product.code, facilityId: fixture.facilityId, formulationId: formulation.id,
      sourceBiocharStorageLocationId: source.id, storageLocationId: binId,
      placedAt: localInstant(product.daysAgo, PRODUCT_PLACEMENT_TIME).toISOString(), massKg: product.wetKg,
      moistureContentPercent: product.moisturePercent, waterAddedKg: WATER_ADDED_KG, idempotencyKey: randomUUID(),
    });
    const products = [await place(mixBin.id, MIX_PRODUCT)];
    let splitBin: DeliveryEvalFixture["splitBin"] = null;
    if (caseId === "delivery-split-bin") {
      splitBin = await createStorageLocation(fixture.ctx, { code: DELIVERY_SPLIT_BIN_CODE, name: DELIVERY_SPLIT_BIN_CODE,
        facilityId: fixture.facilityId, type: "product_bin", stockMode: "split", drawOrder: "oldest_first", formulationId: formulation.id });
      for (const product of SPLIT_PRODUCTS) products.push(await place(splitBin.id, product));
    }
    const order = await db.transaction((tx) => createOrderInTransaction(fixture.ctx, tx, { code: DELIVERY_ORDER_CODE,
      facilityId: fixture.facilityId, customerId: customer.id, customerLocationId: location.id, formulationId: formulation.id,
      orderDate: new Date(today), quantityKg: ORDER_QUANTITY_KG, packaging: "loose" }));
    const credential = await createApiKey(fixture.ctx, { name: "MCP evaluation", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const bin = splitBin ?? mixBin;
    return { ...fixture, key: credential.key, customer: { id: customer.id, code: customer.code }, locationId: location.id,
      formulation: { id: formulation.id, code: formulation.code }, mixBin: { id: mixBin.id, code: mixBin.code }, splitBin,
      products: products.map(({ id, code }) => ({ id, code })),
      target: { facilityId: fixture.facilityId, timeZone, orderId: order.id, orderCode: order.code, binId: bin.id, binCode: bin.code },
      seededMovementIds: (await db.select({ id: binMovements.id }).from(binMovements).where(eq(binMovements.organizationId, org))).map(({ id }) => id),
    };
  } catch (error) {
    const failure = new Error(`Could not seed delivery evaluation organization ${org}. Check the test database schema and auth configuration.`, { cause: error });
    try {
      await cleanupDeliveryFixture(fixture);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], failure.message, { cause: error });
    }
    throw failure;
  }
}

export function deliveryTarget(fixture: DeliveryEvalFixture, startedAt: Date, finishedAt: Date): DeliveryTarget {
  return { ...fixture.target, deliveryDays: deliveryDays(startedAt, finishedAt, fixture.target.timeZone) };
}

/** Read all deliveries and post-seed writes in the isolated organization, not just the requested order. */
export async function readDeliverySnapshot(fixture: DeliveryEvalFixture): Promise<DeliveryDatabaseSnapshot> {
  const org = fixture.ctx.organizationId;
  const [rows, movements, audits] = await Promise.all([
    db.select({ facilityId: deliveries.facilityId, orderId: deliveries.orderId, storageLocationId: deliveries.storageLocationId,
      deliveredAt: deliveries.deliveryDate, deliveredWetMassKg: deliveries.deliveredWetMassKg,
      moisturePercent: deliveries.moistureContentPercent, distanceKmOverride: deliveries.distanceKmOverride })
      .from(deliveries).where(eq(deliveries.organizationId, org)),
    db.select({ id: binMovements.id, binId: binMovements.storageLocationId, kind: binMovements.outputKind, input: binMovements.inputSnapshot })
      .from(binMovements).where(eq(binMovements.organizationId, org)),
    db.select(apiAuditColumns)
      .from(activityEvents).where(apiActivityWhere(org)).then((rows) => rows.map(toApiAuditRow)),
  ]);
  return { deliveries: rows.map((row) => ({ ...row, deliveredAt: row.deliveredAt.toISOString() })),
    movements: movements.filter(({ id }) => !fixture.seededMovementIds.includes(id)), audits };
}

export async function cleanupDeliveryFixture(fixture: IntakeFixture): Promise<void> {
  const org = fixture.ctx.organizationId;
  // Remove posting children and logistics parents before the intake helper removes bins, runs and the facility.
  await db.transaction(async (tx) => {
    for (const table of [outputStockRunAllocations, outputStockMoistureReadings, outputStockAllocations, productIngredientSnapshots,
      binMovements, transportLegs, deliveries, orders, biocharProductSourceAllocations, biocharProducts,
      customerLocations, customers, formulationIngredients, formulations]) {
      await tx.delete(table).where(eq(table.organizationId, org));
    }
  });
  await cleanupFixture(fixture);
}
