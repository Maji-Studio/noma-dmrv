import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertThrowawayTestDatabase } from "../../tests/helpers/throwaway-database";

const FIXTURE_LABEL = "API fuzz fixture";
const FACILITY_TIME_ZONE = "UTC";
const INTAKE_WET_MASS_KG = 100;
const INTAKE_MOISTURE_PERCENT = 20;
const PRIVATE_FILE_MODE = 0o600;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) {
    throw new Error("Usage: pnpm tsx scripts/api-fuzz/seed.ts <private-output.json>");
  }
  // Validate the target before importing anything that initializes DB/auth.
  assertThrowawayTestDatabase(process.env.DATABASE_URL ?? "");
  Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? "test" });
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
  const { createStorageLocation } = await import("@/data-access/storage-locations");
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
  const facility = await createFacility(ctx, {
    code: "FUZZ-FAC", name: FIXTURE_LABEL, country: "FR", timezone: FACILITY_TIME_ZONE,
  });
  const supplier = await createSupplier(ctx, { code: "FUZZ-SUP", name: FIXTURE_LABEL });
  const feedstockType = await createFeedstockType(ctx, {
    code: "FUZZ-WOOD", name: FIXTURE_LABEL, category: "forestry", usage: "pyrolysis",
  });
  const bin = await createStorageLocation(ctx, {
    code: "FUZZ-BIN", name: FIXTURE_LABEL, type: "feedstock_bin",
    facilityId: facility.id, feedstockTypeId: feedstockType.id,
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
  const credential = await createApiKey(ctx, {
    name: FIXTURE_LABEL, scopes: [...API_SCOPES], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  });
  // Mask before the workflow extracts the key into GITHUB_ENV. Outside Actions
  // the key is only written to the private JSON file, never to the terminal.
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${credential.key}`);
  await writeFile(outputPath, JSON.stringify({
    key: credential.key, credentialId: credential.id, organizationId, userId,
    facilityId: facility.id, facilityCode: facility.code,
    supplierId: supplier.id, supplierCode: supplier.code,
    feedstockTypeId: feedstockType.id, feedstockTypeCode: feedstockType.code,
    binId: bin.id, binCode: bin.code,
    driverId: driver.id, driverCode: driver.code, vehicleId: vehicle.id, vehicleCode: vehicle.code,
    // Supplier locations have no code column or by-id API route.
    supplierLocationId: supplierLocation.id,
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
