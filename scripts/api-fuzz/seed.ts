import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertThrowawayTestDatabase } from "../../tests/helpers/throwaway-database";

const FIXTURE_LABEL = "API fuzz fixture";
const FACILITY_TIME_ZONE = "UTC";
const INTAKE_WET_MASS_KG = 100;
const INTAKE_MOISTURE_PERCENT = 20;
const RUN_DRAW_WET_MASS_KG = 10;
const SEEDED_RUN_START_HOURS_AGO = 3;
const SEEDED_RUN_END_HOURS_AGO = 2;
// The completed run that fills the biochar bin ends before the product, which
// precedes the loss. hooks.py places its create example later still.
const OUTPUT_RUN_START_HOURS_AGO = 6;
const OUTPUT_RUN_END_HOURS_AGO = 5;
const OUTPUT_RUN_DRAW_WET_MASS_KG = 60;
const BIOCHAR_OUTPUT_WET_MASS_KG = 20;
const BIOCHAR_MOISTURE_PERCENT = 10;
const PRODUCT_PLACED_HOURS_AGO = 4;
const PRODUCT_BIOCHAR_WET_MASS_KG = 5;
const LOSS_HOURS_AGO = 3.5;
const LOSS_WET_MASS_KG = 1;
const BLEND_BIOCHAR_RATIO = 0.8;
const BLEND_INGREDIENT_RATIO = 0.2;
// The credit batch covers the completed run's day and the day before, so a sample
// taken shortly before now is inside its window whatever the clock reads.
const BATCH_WINDOW_DAYS_BACK = 1;
const SAMPLE_TAKEN_HOURS_AGO = 1;
const SAMPLE_TOTAL_CARBON_PERCENT = 80;
const SAMPLE_ORGANIC_CARBON_PERCENT = 78;
const SAMPLE_INORGANIC_CARBON_PERCENT = 2;
const SAMPLE_HYDROGEN_PERCENT = 2.5;
const ORDER_QUANTITY_KG = 10_000;
const DELIVERY_WET_MASS_KG = 0.1;
const DELIVERY_HOURS_AGO = 1;
const CUSTOMER_DISTANCE_KM = 25;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const PRIVATE_FILE_MODE = 0o600;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) {
    throw new Error("Usage: pnpm tsx scripts/api-fuzz/seed.ts <private-output.json>");
  }
  // Validate the target before importing anything that initializes DB/auth.
  assertThrowawayTestDatabase(process.env.DATABASE_URL ?? "");
  Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? "test" });
  // Seed and server must use the same exported root; never fall back to a real bucket.
  if (process.env.STORAGE_PROVIDER !== "local-fs" || !process.env.STORAGE_LOCAL_FS_ROOT) {
    throw new Error("Export STORAGE_PROVIDER=local-fs and STORAGE_LOCAL_FS_ROOT=.storage-api-fuzz for both seed and server.");
  }
  const outputPath = resolve(args[0]);
  const { db } = await import("@/db");
  const { organizations, users, members, facilities } = await import("@/db/schema");
  const { createFacility } = await import("@/data-access/facilities");
  const { createDriver, createVehicle } = await import("@/data-access/quick-add");
  const { feedstockEtag } = await import("@/lib/api/representation-etags");
  const { runOperation } = await import("@/lib/operations/runner");
  const { logFeedstockDelivery } = await import("@/lib/operations/feedstocks");
  const { formatFacilityDate } = await import("@/lib/date-utils");
  const { createSupplierLocation } = await import("@/data-access/suppliers");
  const { createSupplier } = await import("@/data-access/suppliers");
  const { createFeedstockType } = await import("@/data-access/feedstock-types");
  const { createReactor } = await import("@/data-access/reactors");
  const { startProductionRun, updateProductionRun } = await import("@/lib/operations/production-runs");
  const { productionRunEtag } = await import("@/lib/api/representation-etags");
  const { createStorageLocation } = await import("@/data-access/storage-locations");
  const { createFormulation } = await import("@/data-access/formulations");
  const { readApiBiocharProduct } = await import("@/lib/read-models/api-biochar-products");
  const { makeBiocharProduct } = await import("@/lib/operations/biochar-products");
  const { recordOutputStockMovement } = await import("@/lib/operations/output-stock");
  const { biocharProductEtag, creditBatchEtag, labSampleEtag, orderEtag, deliveryEtag } = await import("@/lib/api/representation-etags");
  const { createCreditBatch } = await import("@/data-access/credit-batches");
  const { recordLabSample } = await import("@/lib/operations/lab-samples");
  const { createCustomer, createCustomerLocation } = await import("@/data-access/customers");
  const { recordDelivery } = await import("@/lib/operations/deliveries");
  const { recordOrder } = await import("@/lib/operations/orders");
  const { createApiKey } = await import("@/data-access/api-keys");
  const { API_SCOPES } = await import("@/lib/auth/api-scopes");
  const { API_KEY_DEFAULT_EXPIRY_SECONDS } = await import("@/config/api-keys");

  // The migration chain seeds a default organization (drizzle/0079), so an
  // empty database is one without domain rows.
  if ((await db.select({ id: facilities.id }).from(facilities).limit(1)).length) {
    throw new Error("API fuzz seed requires an empty migrated throwaway database.");
  }
  const organizationId = randomUUID();
  const userId = randomUUID();
  // CLI-only identity foundation, as in scripts/eval-mcp/fixture.ts. There is
  // no session on an empty DB. Domain rows below use guarded data-access.
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: organizationId, name: FIXTURE_LABEL, slug: `api-fuzz-${organizationId}` });
    await tx.insert(users).values({ id: userId, email: `${userId}@example.test`, name: FIXTURE_LABEL, emailVerified: true });
    await tx.insert(members).values({ id: randomUUID(), organizationId, userId, role: "owner" });
  });
  const ctx = { organizationId, userId, orgRole: "owner" as const, isPlatformAdmin: false };
  // A 200-year facility. Mean R0 and TGA are optional for Samples at either tier.
  const facility = await createFacility(ctx, {
    code: "FUZZ-FAC", name: FIXTURE_LABEL, country: "FR", timezone: FACILITY_TIME_ZONE,
    durabilityOption: "200_year",
  });
  const supplier = await createSupplier(ctx, { code: "FUZZ-SUP", name: FIXTURE_LABEL });
  const feedstockType = await createFeedstockType(ctx, {
    code: "FUZZ-WOOD", name: FIXTURE_LABEL, category: "forestry", usage: "pyrolysis",
  });
  const bin = await createStorageLocation(ctx, {
    code: "FUZZ-BIN", name: FIXTURE_LABEL, type: "feedstock_bin",
    facilityId: facility.id, feedstockTypeId: feedstockType.id,
  });
  // The run draws from its own bin so the feedstock cases keep their stock.
  const runBin = await createStorageLocation(ctx, {
    code: "FUZZ-RUN-BIN", name: `${FIXTURE_LABEL} run bin`, type: "feedstock_bin",
    facilityId: facility.id, feedstockTypeId: feedstockType.id,
  });
  const reactor = await createReactor(ctx, {
    code: "FUZZ-RX", identifier: "FUZZ-RX-1", facilityId: facility.id, reactorType: "fixed-bed",
  });
  const driver = await createDriver(ctx, { code: "FUZZ-DRV", name: FIXTURE_LABEL });
  const vehicle = await createVehicle(ctx, { code: "FUZZ-VEH", name: FIXTURE_LABEL, vehicleType: "truck" });
  const supplierLocation = await createSupplierLocation(ctx, { supplierId: supplier.id, name: FIXTURE_LABEL, country: "FR" });
  const intake = await runOperation(logFeedstockDelivery, ctx, {
    facilityId: facility.id, supplierId: supplier.id, feedstockTypeId: feedstockType.id,
    deliveryDate: formatFacilityDate(new Date(), FACILITY_TIME_ZONE),
    totalWetMassKg: INTAKE_WET_MASS_KG, moisturePercent: INTAKE_MOISTURE_PERCENT,
    allocations: [{ storageLocationId: bin.id, allocatedWetMassKg: INTAKE_WET_MASS_KG }],
  });
  const feedstock = intake.data.feedstocks[0];
  if (!feedstock) throw new Error("API fuzz intake did not create a feedstock.");
  await runOperation(logFeedstockDelivery, ctx, {
    facilityId: facility.id, supplierId: supplier.id, feedstockTypeId: feedstockType.id,
    deliveryDate: formatFacilityDate(new Date(), FACILITY_TIME_ZONE),
    totalWetMassKg: INTAKE_WET_MASS_KG, moisturePercent: INTAKE_MOISTURE_PERCENT,
    allocations: [{ storageLocationId: runBin.id, allocatedWetMassKg: INTAKE_WET_MASS_KG }],
  });
  // A failed run with a closed window in the past. hooks.py builds its seeded create from a
  // later window on the same reactor, so the overlap guard does not refuse it.
  const now = Date.now();
  const startedRun = (await runOperation(startProductionRun, ctx, {
    facilityId: facility.id, reactorId: reactor.id, status: "running",
    startTime: new Date(now - SEEDED_RUN_START_HOURS_AGO * MS_PER_HOUR).toISOString(),
    endTime: null,
    feedstockDraws: [{ storageLocationId: runBin.id, wetMassKg: RUN_DRAW_WET_MASS_KG }],
    feedstockMoisturePercent: INTAKE_MOISTURE_PERCENT,
  })).data;
  const run = (await runOperation(updateProductionRun, ctx, {
    productionRunId: startedRun.id, expectedVersion: startedRun.version, status: "failed",
    endTime: new Date(now - SEEDED_RUN_END_HOURS_AGO * MS_PER_HOUR).toISOString(),
  })).data;
  // Biochar side. Bin and formulation names are unique per facility.
  const biocharBin = await createStorageLocation(ctx, {
    code: "FUZZ-BC-BIN", name: `${FIXTURE_LABEL} biochar bin`, type: "biochar_bin", facilityId: facility.id,
  });
  const productBin = await createStorageLocation(ctx, {
    code: "FUZZ-PB-BIN", name: `${FIXTURE_LABEL} product bin`, type: "product_bin", facilityId: facility.id,
  });
  const outputRun = (await runOperation(startProductionRun, ctx, {
    facilityId: facility.id, reactorId: reactor.id, status: "complete",
    startTime: new Date(now - OUTPUT_RUN_START_HOURS_AGO * MS_PER_HOUR).toISOString(),
    endTime: new Date(now - OUTPUT_RUN_END_HOURS_AGO * MS_PER_HOUR).toISOString(),
    feedstockDraws: [{ storageLocationId: runBin.id, wetMassKg: OUTPUT_RUN_DRAW_WET_MASS_KG }],
    feedstockMoisturePercent: INTAKE_MOISTURE_PERCENT,
    biocharStorageLocationId: biocharBin.id, biocharOutputKg: BIOCHAR_OUTPUT_WET_MASS_KG,
    biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT,
  })).data;
  // One month at most (credit_batches_isometric_max_one_month); the completed run
  // joins by id. The failed run is not complete, so the batch ignores it.
  const creditBatch = await createCreditBatch(ctx, {
    code: "FUZZ-CB", facilityId: facility.id, feedstockTypeId: feedstockType.id,
    startDate: new Date(now - BATCH_WINDOW_DAYS_BACK * MS_PER_DAY), endDate: new Date(now),
    productionRunIds: [outputRun.id],
  });
  const labSample = (await runOperation(recordLabSample, ctx, {
    creditBatchId: creditBatch.id,
    samplingTime: new Date(now - SAMPLE_TAKEN_HOURS_AGO * MS_PER_HOUR).toISOString(),
    totalCarbonPercent: SAMPLE_TOTAL_CARBON_PERCENT, organicCarbonPercent: SAMPLE_ORGANIC_CARBON_PERCENT,
    inorganicCarbonPercent: SAMPLE_INORGANIC_CARBON_PERCENT, totalHydrogenPercent: SAMPLE_HYDROGEN_PERCENT,
  })).data.sample;
  const pure = await createFormulation(ctx, { code: "FUZZ-PURE", name: `${FIXTURE_LABEL} pure biochar`, biocharRatio: 1 });
  const blendType = await createFeedstockType(ctx, {
    code: "FUZZ-BLEND", name: `${FIXTURE_LABEL} blend ingredient`, category: "compost", usage: "blend",
  });
  const blend = await createFormulation(ctx, {
    code: "FUZZ-MIX", name: `${FIXTURE_LABEL} blend`, biocharRatio: BLEND_BIOCHAR_RATIO,
    ingredients: [{ feedstockTypeId: blendType.id, ratio: BLEND_INGREDIENT_RATIO }],
  });
  const product = (await runOperation(makeBiocharProduct, ctx, {
    facilityId: facility.id, formulationId: pure.id,
    placedAt: new Date(now - PRODUCT_PLACED_HOURS_AGO * MS_PER_HOUR).toISOString(),
    sourceBiocharStorageLocationId: biocharBin.id, storageLocationId: productBin.id,
    biocharWetMassKg: PRODUCT_BIOCHAR_WET_MASS_KG, biocharMoisturePercent: BIOCHAR_MOISTURE_PERCENT, waterAddedKg: 0,
  })).data.product;
  const loss = (await runOperation(recordOutputStockMovement, ctx, {
    storageLocationId: biocharBin.id, kind: "loss",
    occurredAt: new Date(now - LOSS_HOURS_AGO * MS_PER_HOUR).toISOString(),
    wetMassKg: LOSS_WET_MASS_KG, moisturePercent: BIOCHAR_MOISTURE_PERCENT, reason: "API fuzz fixture loss",
  })).data;
  const customer = await createCustomer(ctx, { code: "FUZZ-CUS", name: FIXTURE_LABEL });
  const customerLocation = await createCustomerLocation(ctx, {
    customerId: customer.id, name: FIXTURE_LABEL, country: "FR",
    distanceFromFacilityKm: CUSTOMER_DISTANCE_KM, distanceSource: "manual", isDefault: true,
  });
  const orderInput = {
    facilityId: facility.id, customerId: customer.id, customerLocationId: customerLocation.id,
    formulationId: pure.id, orderDate: formatFacilityDate(new Date(now), FACILITY_TIME_ZONE),
    quantityKg: ORDER_QUANTITY_KG, packaging: "loose" as const,
  };
  const order = (await runOperation(recordOrder, ctx, orderInput)).data;
  // Keep a second order delivery-free for the DELETE dry run.
  const deleteOrder = (await runOperation(recordOrder, ctx, orderInput)).data;
  // Leave almost all of the product's 5 wet kg for repeated small dry runs.
  const delivery = (await runOperation(recordDelivery, ctx, {
    orderId: order.id, storageLocationId: productBin.id,
    deliveredAt: new Date(now - DELIVERY_HOURS_AGO * MS_PER_HOUR).toISOString(),
    deliveredWetMassKg: DELIVERY_WET_MASS_KG, moisturePercent: BIOCHAR_MOISTURE_PERCENT,
  })).data.delivery;
  // Delivery posting bumps the product version; PATCH must use its current ETag.
  const currentProduct = await readApiBiocharProduct(ctx, { id: product.id });
  const { seedDocuments } = await import("./seed-documents");
  const documents = await seedDocuments(ctx, { delivery: delivery.id, feedstock: feedstock.id, lab_sample: labSample.id });
  const credential = await createApiKey(ctx, {
    name: FIXTURE_LABEL, scopes: [...API_SCOPES], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  });
  // Mask before the workflow extracts the key into GITHUB_ENV. Outside Actions
  // the key is only written to the private JSON file, never to the terminal.
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${credential.key}`);
  await writeFile(outputPath, JSON.stringify({
    documents,
    key: credential.key, credentialId: credential.id, organizationId, userId,
    facilityId: facility.id, facilityCode: facility.code,
    supplierId: supplier.id, supplierCode: supplier.code,
    feedstockTypeId: feedstockType.id, feedstockTypeCode: feedstockType.code,
    binId: bin.id, binCode: bin.code, runBinId: runBin.id,
    reactorId: reactor.id, reactorCode: reactor.code,
    productionRunId: run.id, productionRunCode: run.code, productionRunEtag: productionRunEtag(run),
    driverId: driver.id, driverCode: driver.code, vehicleId: vehicle.id, vehicleCode: vehicle.code,
    // Supplier locations have no code column or by-id API route.
    supplierLocationId: supplierLocation.id,
    biocharBinId: biocharBin.id, biocharBinCode: biocharBin.code, productBinId: productBin.id,
    pureFormulationId: pure.id, pureFormulationCode: pure.code, blendFormulationId: blend.id, blendFormulationCode: blend.code,
    biocharProductId: product.id, biocharProductCode: product.code, biocharProductEtag: biocharProductEtag(currentProduct),
    customerId: customer.id, customerCode: customer.code,
    // Customer locations, like supplier locations, have no code column.
    customerLocationId: customerLocation.id,
    orderId: order.id, orderCode: order.code, orderEtag: orderEtag(order),
    deliveryId: delivery.id, deliveryCode: delivery.code, deliveryEtag: deliveryEtag(delivery),
    deleteOrderId: deleteOrder.id, deleteOrderCode: deleteOrder.code, deleteOrderEtag: orderEtag(deleteOrder),
    lossMovementId: loss.movementId,
    creditBatchId: creditBatch.id, creditBatchCode: creditBatch.code, creditBatchEtag: creditBatchEtag(creditBatch),
    labSampleId: labSample.id, labSampleCode: labSample.sampleCode, labSampleEtag: labSampleEtag(labSample),
    feedstockId: feedstock.id, feedstockCode: feedstock.code, feedstockEtag: feedstockEtag(feedstock),
  }, null, 2) + "\n", { mode: PRIVATE_FILE_MODE, flag: "wx" });
  console.log(`API_FUZZ_FIXTURE=${outputPath}`);
  console.log(`ORGANIZATION_ID=${organizationId}`);
  console.log(`FACILITY_ID=${facility.id}`);
  console.log(`SUPPLIER_ID=${supplier.id}`);
  console.log(`FEEDSTOCK_TYPE_ID=${feedstockType.id}`);
  console.log(`BIN_ID=${bin.id}`);
}

void main().catch(async (error: unknown) => {
  // Raw DB/auth errors can contain bound values: print only the scrubbed
  // message, the error class and the Postgres code.
  const { sanitizeErrorMessage } = await import("@/lib/log/sanitize");
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  console.error(`API fuzz seed failed (${name}${code ? ` ${String(code)}` : ""}): ${sanitizeErrorMessage(error)}`);
  console.error("Check arguments, exported app env, the local test database target, and that migrations ran on an empty database.");
  process.exitCode = 1;
});
