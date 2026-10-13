/**
 * Editing and deleting vehicles, drivers and operators (issue #945), against
 * the real test database: org scoping, the delete guard, and the vehicle type
 * lock while a submitted credit batch uses the vehicle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certificationSubmissions,
  creditBatches,
  deliveries,
  drivers,
  feedstocks,
  operators,
  organizations,
  productionRuns,
  transportLegs,
  vehicles,
  type Vehicle,
} from "@/db/schema";
import { deleteDriver, getDriver, listDrivers, updateDriver } from "@/data-access/drivers";
import { deleteOperator, getOperator, listOperators, updateOperator } from "@/data-access/operators";
import { deleteVehicle, getVehicle, listVehicles, updateVehicle } from "@/data-access/vehicles";
import type { OrgContext } from "@/lib/auth/server";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import {
  waitForAdvisoryLockWait,
  withLineageFixture,
  type LineageFixture,
} from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const OTHER_ORG_ID = `org_fleet_other_${crypto.randomUUID().slice(0, 8)}`;
const otherCtx: OrgContext = {
  userId: "user_fleet_other",
  organizationId: OTHER_ORG_ID,
  orgRole: "owner",
  isPlatformAdmin: false,
};

const LEG_DISTANCE_KM = 40;
const LEG_LOAD_KG = 1_000;
const ORIGINAL_MODEL_YEAR = 2018;
const LOCKED_COPY = "is locked by a certification submission.";

const createdVehicleIds: string[] = [];
const createdDriverIds: string[] = [];
const createdOperatorIds: string[] = [];

async function insertVehicle(overrides: Partial<typeof vehicles.$inferInsert> = {}): Promise<Vehicle> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const [vehicle] = await db.insert(vehicles).values({
    organizationId: TEST_ORG_ID,
    code: `VEH-FLT-${tag}`,
    name: `Fleet truck ${tag}`,
    vehicleType: "truck",
    modelYear: ORIGINAL_MODEL_YEAR,
    ...overrides,
  }).returning();
  createdVehicleIds.push(vehicle.id);
  return vehicle;
}

async function insertDriver() {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const [driver] = await db.insert(drivers).values({
    organizationId: TEST_ORG_ID,
    code: `DRV-FLT-${tag}`,
    name: `Fleet driver ${tag}`,
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function insertOperator() {
  const [operator] = await db.insert(operators).values({
    organizationId: TEST_ORG_ID,
    name: `Fleet operator ${crypto.randomUUID().slice(0, 8)}`,
  }).returning();
  createdOperatorIds.push(operator.id);
  return operator;
}

/** Put the vehicle on the fixture's feedstock and give it a derived leg. */
async function useVehicleOnFeedstock(fixture: LineageFixture, vehicle: Vehicle) {
  await db.update(feedstocks).set({ vehicleId: vehicle.id }).where(eq(feedstocks.id, fixture.feedstockId));
  const [leg] = await db.insert(transportLegs).values({
    organizationId: TEST_ORG_ID,
    entityType: "feedstock",
    entityId: fixture.feedstockId,
    isDerived: true,
    distanceKm: LEG_DISTANCE_KM,
    transportMethodType: "road",
    vehicleType: vehicle.vehicleType,
    modelYear: vehicle.modelYear,
    loadMassKg: LEG_LOAD_KG,
  }).returning();
  return leg;
}

/** Detach fleet references before the lineage fixture deletes its rows. */
async function detachFleet(fixture: LineageFixture) {
  await db.update(feedstocks).set({ vehicleId: null }).where(eq(feedstocks.id, fixture.feedstockId));
  await db.update(deliveries).set({ vehicleId: null, driverId: null }).where(eq(deliveries.id, fixture.deliveryId));
  await db.update(productionRuns).set({ operatorId: null }).where(eq(productionRuns.id, fixture.productionRunId));
}

async function withFleetFixture(
  testFn: (fixture: LineageFixture) => Promise<void>,
  blockingVia: "none" | "removal" = "removal",
) {
  await withLineageFixture(async (fixture) => {
    try {
      await testFn(fixture);
    } finally {
      await detachFleet(fixture);
    }
  }, blockingVia);
}

async function batchCode(batchId: string) {
  const [batch] = await db.select({ code: creditBatches.code }).from(creditBatches).where(eq(creditBatches.id, batchId));
  return batch.code;
}

async function derivedLeg(feedstockId: string) {
  const [leg] = await db.select().from(transportLegs).where(and(
    eq(transportLegs.entityType, "feedstock"),
    eq(transportLegs.entityId, feedstockId),
    eq(transportLegs.isDerived, true),
  ));
  return leg;
}

function vehicleEdit(vehicle: Vehicle, overrides: Partial<Parameters<typeof updateVehicle>[2]> = {}) {
  return {
    name: vehicle.name,
    vehicleType: vehicle.vehicleType,
    identifier: vehicle.identifier,
    fuelType: vehicle.fuelType,
    fuelConsumptionLPerKm: vehicle.fuelConsumptionLPerKm,
    modelYear: vehicle.modelYear,
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(organizations).values({ id: OTHER_ORG_ID, name: "Fleet other org", slug: OTHER_ORG_ID }).onConflictDoNothing();
});

afterAll(async () => {
  if (createdVehicleIds.length) await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds));
  if (createdDriverIds.length) await db.delete(drivers).where(inArray(drivers.id, createdDriverIds));
  if (createdOperatorIds.length) await db.delete(operators).where(inArray(operators.id, createdOperatorIds));
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG_ID));
});

describe("org scoping", () => {
  it("hides another organization's vehicles, drivers and operators", async () => {
    const vehicle = await insertVehicle();
    const driver = await insertDriver();
    const operator = await insertOperator();

    expect(await getVehicle(otherCtx, vehicle.id)).toBeNull();
    expect(await getDriver(otherCtx, driver.id)).toBeNull();
    expect(await getOperator(otherCtx, operator.id)).toBeNull();
    expect((await listVehicles(otherCtx)).map((row) => row.id)).not.toContain(vehicle.id);
    expect((await listDrivers(otherCtx)).map((row) => row.id)).not.toContain(driver.id);
    expect((await listOperators(otherCtx)).map((row) => row.id)).not.toContain(operator.id);
    expect((await listVehicles(ctx)).map((row) => row.id)).toContain(vehicle.id);
  });

  it("refuses another organization's update and delete without changing the row", async () => {
    const vehicle = await insertVehicle();
    const driver = await insertDriver();
    const operator = await insertOperator();

    await expect(updateVehicle(otherCtx, vehicle.id, vehicleEdit(vehicle, { name: "Hijacked" }), vehicle.version))
      .rejects.toThrow("Vehicle was not found.");
    await expect(deleteVehicle(otherCtx, vehicle.id, vehicle.version)).rejects.toThrow("Vehicle was not found.");
    await expect(updateDriver(otherCtx, driver.id, { name: "Hijacked" }, driver.version)).rejects.toThrow("Driver was not found.");
    await expect(deleteDriver(otherCtx, driver.id, driver.version)).rejects.toThrow("Driver was not found.");
    await expect(updateOperator(otherCtx, operator.id, { name: "Hijacked" })).rejects.toThrow("Operator was not found.");
    await expect(deleteOperator(otherCtx, operator.id)).rejects.toThrow("Operator was not found.");

    expect((await getVehicle(ctx, vehicle.id))?.name).toBe(vehicle.name);
    expect((await getDriver(ctx, driver.id))?.name).toBe(driver.name);
    expect((await getOperator(ctx, operator.id))?.name).toBe(operator.name);
  });
});

describe("metadata edits", () => {
  it("updates every vehicle field and bumps the version", async () => {
    const vehicle = await insertVehicle();
    const updated = await updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, {
      name: `${vehicle.name} renamed`,
      identifier: "T 123 ABC",
      fuelType: "Diesel",
      fuelConsumptionLPerKm: 0.3,
      vehicleType: "van",
    }), vehicle.version);

    expect(updated).toMatchObject({
      name: `${vehicle.name} renamed`,
      identifier: "T 123 ABC",
      fuelType: "Diesel",
      vehicleType: "van",
      version: vehicle.version + 1,
    });
    expect(updated.fuelConsumptionLPerKm).toBeCloseTo(0.3);
  });

  it("refuses a stale vehicle or driver save", async () => {
    const vehicle = await insertVehicle();
    const driver = await insertDriver();
    await expect(updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, { name: "Stale" }), vehicle.version + 1))
      .rejects.toThrow(STALE_VERSION_MESSAGE);
    await expect(updateDriver(ctx, driver.id, { name: "Stale" }, driver.version + 1))
      .rejects.toThrow(STALE_VERSION_MESSAGE);
  });

  it("refuses a vehicle name another vehicle already has", async () => {
    const first = await insertVehicle();
    const second = await insertVehicle();
    await expect(updateVehicle(ctx, second.id, vehicleEdit(second, { name: first.name }), second.version))
      .rejects.toThrow("A vehicle with this name already exists");
  });

  it("updates drivers and operators", async () => {
    const driver = await insertDriver();
    const operator = await insertOperator();

    const savedDriver = await updateDriver(ctx, driver.id, { name: "Asha", licenseNumber: "LIC-9", contactPhone: null }, driver.version);
    expect(savedDriver).toMatchObject({ name: "Asha", licenseNumber: "LIC-9", version: driver.version + 1 });

    const savedOperator = await updateOperator(ctx, operator.id, { name: "Baraka", credentials: "Kiln lead" });
    expect(savedOperator).toMatchObject({ name: "Baraka", credentials: "Kiln lead" });
  });
});

describe("delete guard", () => {
  it("deletes unused records", async () => {
    const vehicle = await insertVehicle();
    const driver = await insertDriver();
    const operator = await insertOperator();

    await deleteVehicle(ctx, vehicle.id, vehicle.version);
    await deleteDriver(ctx, driver.id, driver.version);
    await deleteOperator(ctx, operator.id);

    expect(await getVehicle(ctx, vehicle.id)).toBeNull();
    expect(await getDriver(ctx, driver.id)).toBeNull();
    expect(await getOperator(ctx, operator.id)).toBeNull();
  });

  it("refuses to delete records that intakes, deliveries or production runs use, and says where", async () => {
    await withFleetFixture(async (fixture) => {
      const vehicle = await insertVehicle();
      const driver = await insertDriver();
      const operator = await insertOperator();
      await db.update(feedstocks).set({ vehicleId: vehicle.id }).where(eq(feedstocks.id, fixture.feedstockId));
      await db.update(deliveries).set({ vehicleId: vehicle.id, driverId: driver.id }).where(eq(deliveries.id, fixture.deliveryId));
      await db.update(productionRuns).set({ operatorId: operator.id }).where(eq(productionRuns.id, fixture.productionRunId));

      await expect(deleteVehicle(ctx, vehicle.id, vehicle.version)).rejects.toThrow(
        `Vehicle ${vehicle.code} was not deleted because 1 feedstock intake and 1 delivery use it.`,
      );
      await expect(deleteDriver(ctx, driver.id, driver.version)).rejects.toThrow(
        `Driver ${driver.code} was not deleted because 1 delivery uses it.`,
      );
      await expect(deleteOperator(ctx, operator.id)).rejects.toThrow(
        "This operator was not deleted because 1 production run uses it.",
      );

      expect(await getVehicle(ctx, vehicle.id)).not.toBeNull();
      expect(await getDriver(ctx, driver.id)).not.toBeNull();
      expect(await getOperator(ctx, operator.id)).not.toBeNull();
    }, "none");
  });
});

describe("vehicle type change", () => {
  it("refreshes the derived leg when no submitted credit batch uses the vehicle", async () => {
    await withFleetFixture(async (fixture) => {
      const vehicle = await insertVehicle();
      const leg = await useVehicleOnFeedstock(fixture, vehicle);

      await updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, { vehicleType: "tractor", modelYear: 2021 }), vehicle.version);

      const refreshed = await derivedLeg(fixture.feedstockId);
      expect(refreshed).toMatchObject({ vehicleType: "tractor", modelYear: 2021, version: leg.version + 1 });
      expect(refreshed.distanceKm).toBe(LEG_DISTANCE_KM);
    }, "none");
  });

  it("refuses a type change while a submitted credit batch uses the vehicle, naming the batch", async () => {
    await withFleetFixture(async (fixture) => {
      const vehicle = await insertVehicle();
      await useVehicleOnFeedstock(fixture, vehicle);
      const code = await batchCode(fixture.batchId);

      const refusal = updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, { vehicleType: "tractor" }), vehicle.version);
      await expect(refusal).rejects.toThrow(LOCKED_COPY);
      await expect(refusal).rejects.toThrow(`Credit batch ${code} uses this vehicle's type.`);
      await expect(refusal).rejects.toMatchObject({
        code: "certification_locked",
        conflict: { entity: "creditBatch", id: fixture.batchId, code },
      });

      expect((await getVehicle(ctx, vehicle.id))?.vehicleType).toBe("truck");
      expect((await derivedLeg(fixture.feedstockId)).vehicleType).toBe("truck");
    });
  });

  it("refuses a type change when a delivery in a submitted credit batch uses the vehicle", async () => {
    await withFleetFixture(async (fixture) => {
      const vehicle = await insertVehicle();
      await db.update(deliveries).set({ vehicleId: vehicle.id }).where(eq(deliveries.id, fixture.deliveryId));

      await expect(
        updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, { vehicleType: "van" }), vehicle.version),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("keeps metadata editable under a submitted credit batch and leaves the certified leg frozen", async () => {
    await withFleetFixture(async (fixture) => {
      const vehicle = await insertVehicle();
      await useVehicleOnFeedstock(fixture, vehicle);

      const updated = await updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, {
        name: `${vehicle.name} edited`,
        fuelType: "Biodiesel",
        identifier: "T 999 XYZ",
        modelYear: 2022,
      }), vehicle.version);

      expect(updated).toMatchObject({ fuelType: "Biodiesel", modelYear: 2022, vehicleType: "truck" });
      expect((await derivedLeg(fixture.feedstockId)).modelYear).toBe(ORIGINAL_MODEL_YEAR);
    });
  });

  it("waits for a concurrent submission and then refuses the type change", async () => {
    await withFleetFixture(async (fixture) => {
      const vehicle = await insertVehicle();
      await useVehicleOnFeedstock(fixture, vehicle);

      let releaseSubmit = () => {};
      let signalLocked!: (pid: number) => void;
      const locked = new Promise<number>((resolve) => { signalLocked = resolve; });
      const release = new Promise<void>((resolve) => { releaseSubmit = resolve; });
      const submitter = db.transaction(async (tx) => {
        await acquireCertificationArtifactLocksSorted(tx, [
          { provider: "isometric", localEntityType: "removal", localEntityId: fixture.removalId },
        ]);
        await tx.insert(certificationSubmissions).values({
          organizationId: TEST_ORG_ID,
          provider: "isometric",
          submissionType: "removal",
          localEntityType: "removal",
          localEntityId: fixture.removalId,
          externalId: `ext_fleet_${fixture.removalId.slice(0, 8)}`,
          version: 1,
          status: "submitted",
          payloadHash: `hash-fleet-${fixture.removalId.slice(0, 8)}`,
          payloadSnapshot: { fixture: "fleet-edit-delete" },
          submittedAt: new Date("2026-06-17T00:00:00Z"),
        });
        const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        signalLocked(backend.rows[0]?.pid ?? 0);
        await release;
      });

      try {
        const submitterPid = await locked;
        const typeChange = updateVehicle(ctx, vehicle.id, vehicleEdit(vehicle, { vehicleType: "tractor" }), vehicle.version);
        const refusal = expect(typeChange).rejects.toThrow(LOCKED_COPY);
        await waitForAdvisoryLockWait(submitterPid);
        releaseSubmit();
        await submitter;
        await refusal;
        expect((await getVehicle(ctx, vehicle.id))?.vehicleType).toBe("truck");
      } finally {
        releaseSubmit();
        await submitter.catch(() => undefined);
        await db.delete(certificationSubmissions).where(eq(certificationSubmissions.localEntityId, fixture.removalId));
      }
    }, "none");
  });
});
