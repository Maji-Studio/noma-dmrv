/** Point-in-time observations, not regression specifications. No remote calls. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstockTypes, storageLocations, binMovements, feedstocks, suppliers, supplierLocations, feedstockDeliveries } from "@/db/schema";
import { updateStorageLocation } from "@/data-access/storage-locations";
import { getStorageLocationLaneSummary } from "@/data-access/storage-location-lane-summary";
import { createFeedstockType as quickCreateFeedstockType } from "@/data-access/quick-add";
import { createFeedstockType as canonicalCreateFeedstockType, updateFeedstockType } from "@/data-access/feedstock-types";
import { deleteSupplier } from "@/data-access/suppliers";
import { updateFeedstock } from "@/data-access/feedstocks";
import { updateFacility } from "@/data-access/facility-mutations";
import { updateFeedstockTypeSchema } from "@/schemas/feedstock-types";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "../../../../tests/helpers/test-org";

const BIN_STOCK_KG = 25;
const context = makeTestOrgContext();
const auditUrl = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(auditUrl.hostname) ||
  auditUrl.pathname !== "/noma_lifecycle_audit_test"
) throw new Error("Use only the disposable noma_lifecycle_audit_test database on loopback.");

beforeAll(() => ensureTestOrg());

async function fixture() {
  const tag = crypto.randomUUID();
  const [facility] = await db.insert(facilities).values({
    organizationId: TEST_ORG_ID, code: `AUD-${tag}`, name: `Audit ${tag}`, country: "CHE",
  }).returning();
  const [type] = await db.insert(feedstockTypes).values({
    organizationId: TEST_ORG_ID, code: `AUD-${tag}`, name: `Audit ${tag}`,
    usage: "pyrolysis", category: "forestry",
  }).returning();
  const [bin] = await db.insert(storageLocations).values({
    organizationId: TEST_ORG_ID, code: `AUD-${tag}`, name: `Audit ${tag}`,
    facilityId: facility.id, type: "feedstock_bin", feedstockTypeId: type.id,
  }).returning();
  await db.insert(binMovements).values({
    organizationId: TEST_ORG_ID, storageLocationId: bin.id,
    lane: "feedstock", movementType: "adjustment", massDeltaKg: BIN_STOCK_KG,
    reason: "Disposable audit stock fixture",
  });
  return { facility, type, bin };
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await db.delete(binMovements).where(eq(binMovements.storageLocationId, f.bin.id));
  await db.delete(storageLocations).where(eq(storageLocations.id, f.bin.id));
  await db.delete(feedstockTypes).where(eq(feedstockTypes.id, f.type.id));
  await db.delete(facilities).where(eq(facilities.id, f.facility.id));
}

describe("baseline defect observations (passing means reproduced)", () => {
  it("F01: changing a stocked bin's role removes its 25 kg from lane summaries", async () => {
    const f = await fixture();
    try {
      const before = await getStorageLocationLaneSummary(context, { facilityId: f.facility.id, archived: false });
      expect(before.feedstock_bin.onHandKg).toBe(BIN_STOCK_KG);
      await updateStorageLocation(context, f.bin.id, { type: "biochar_bin" });
      const after = await getStorageLocationLaneSummary(context, { facilityId: f.facility.id, archived: false });
      expect(after.feedstock_bin.onHandKg).toBe(0);
      expect(after.biochar_bin.onHandKg).toBe(0);
      const rows = await db.select().from(binMovements).where(eq(binMovements.storageLocationId, f.bin.id));
      expect(rows[0].massDeltaKg).toBe(BIN_STOCK_KG);
      console.log("F01: before=25 kg feedstock; after=0 kg all displayed lanes; movement still=25 kg");
    } finally { await cleanup(f); }
  });

  it("F01: a stocked bin accepts a different feedstock type", async () => {
    const f = await fixture();
    const [other] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID, code: `AUD-${crypto.randomUUID()}`, name: `Audit ${crypto.randomUUID()}`,
      category: "mineral", usage: "blend",
    }).returning();
    try {
      const updated = await updateStorageLocation(context, f.bin.id, { feedstockTypeId: other.id });
      expect(updated.feedstockTypeId).toBe(other.id);
      const summary = await getStorageLocationLaneSummary(context, { facilityId: f.facility.id, archived: false });
      expect(summary.feedstock_bin.onHandKg).toBe(BIN_STOCK_KG);
      console.log("F01: 25 kg retained while bin identity changed from forestry/pyrolysis to mineral/blend");
    } finally {
      await cleanup(f);
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, other.id));
    }
  });

  it("F02: partial feedstock-type update persists an invalid category/usage pair", async () => {
    const f = await fixture();
    try {
      const input = updateFeedstockTypeSchema.parse({ feedstockTypeId: f.type.id, usage: "blend" });
      const updated = await updateFeedstockType(context, input);
      expect(updated.usage).toBe("blend");
      expect(updated.category).toBe("forestry");
      expect(updateFeedstockTypeSchema.safeParse({ feedstockTypeId: f.type.id, usage: "blend", category: "forestry" }).success).toBe(false);
      console.log("F02: partial payload saved forestry/blend; equivalent complete payload rejected");
    } finally { await cleanup(f); }
  });

  it("F03: a stale facility form silently overwrites a newer country change", async () => {
    const f = await fixture();
    try {
      await updateFacility(context, f.facility.id, { country: "USA" });
      const saved = await updateFacility(context, f.facility.id, { name: `${f.facility.name} edited`, country: f.facility.country });
      expect(saved.country).toBe("CHE");
      console.log("F03: operator A saved USA; stale operator B echoed CHE; final country=CHE, no conflict");
    } finally { await cleanup(f); }
  });
});

async function intakeFixture() {
  const f = await fixture();
  await db.delete(binMovements).where(eq(binMovements.storageLocationId, f.bin.id));
  const [intake] = await db.insert(feedstocks).values({
    organizationId: TEST_ORG_ID, code: `AUD-${crypto.randomUUID()}`,
    facilityId: f.facility.id, feedstockTypeId: f.type.id, storageLocationId: f.bin.id,
    massWetKg: 100, massDryKg: 90, moistureContentPercent: 10, status: "complete",
  }).returning();
  return { ...f, intake };
}

describe("feedstock baseline observations", () => {
  it("F06: reducing intake below recorded withdrawal creates negative stock", async () => {
    const f = await intakeFixture();
    try {
      await db.insert(binMovements).values({ organizationId: TEST_ORG_ID,
        storageLocationId: f.bin.id, lane: "feedstock", movementType: "loss",
        massDeltaKg: -80, reason: "Disposable audit withdrawal fixture" });
      const before = await getStorageLocationLaneSummary(context, { facilityId: f.facility.id, archived: false });
      expect(before.feedstock_bin.onHandKg).toBe(20);
      await updateFeedstock(context, f.intake.id, { massWetKg: 50, massDryKg: 45 });
      const after = await getStorageLocationLaneSummary(context, { facilityId: f.facility.id, archived: false });
      expect(after.feedstock_bin.onHandKg).toBe(-30);
      console.log("F06: 100 kg intake - 80 kg loss = 20 kg; edit intake to 50 kg succeeds; final stock=-30 kg");
    } finally {
      await db.delete(feedstocks).where(eq(feedstocks.id, f.intake.id));
      await cleanup(f);
    }
  });
  it("F07: moisture-only update leaves stored dry mass inconsistent", async () => {
    const f = await intakeFixture();
    try {
      await updateFeedstock(context, f.intake.id, { moistureContentPercent: 50 });
      const [saved] = await db.select().from(feedstocks).where(eq(feedstocks.id, f.intake.id));
      expect(saved.massWetKg).toBe(100);
      expect(saved.moistureContentPercent).toBe(50);
      expect(saved.massDryKg).toBe(90);
      console.log("F07: saved wet=100 kg moisture=50% dry=90 kg; consistent derived dry would be 50 kg");
    } finally {
      await db.delete(feedstocks).where(eq(feedstocks.id, f.intake.id));
      await cleanup(f);
    }
  });
});

describe("supplier deletion baseline observation", () => {
  it("F08: a restrictive FK failure leaves the supplier but deletes its locations", async () => {
    const f = await fixture();
    const [supplier] = await db.insert(suppliers).values({ organizationId: TEST_ORG_ID,
      code: `AUD-${crypto.randomUUID()}`, name: `Audit ${crypto.randomUUID()}` }).returning();
    await db.insert(supplierLocations).values({ organizationId: TEST_ORG_ID,
      supplierId: supplier.id, name: "Disposable source location", country: "CHE" });
    const [delivery] = await db.insert(feedstockDeliveries).values({ organizationId: TEST_ORG_ID,
      code: `AUD-${crypto.randomUUID()}`, facilityId: f.facility.id, supplierId: supplier.id,
      deliveryDate: new Date("2026-09-01T12:00:00Z") }).returning();
    try {
      await expect(deleteSupplier(context, supplier.id)).rejects.toThrow();
      expect(await db.select().from(suppliers).where(eq(suppliers.id, supplier.id))).toHaveLength(1);
      expect(await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, supplier.id))).toHaveLength(0);
      console.log("F08: delete rejected by feedstock_deliveries FK; supplier remains; locations were deleted");
    } finally {
      await db.delete(feedstockDeliveries).where(eq(feedstockDeliveries.id, delivery.id));
      await db.delete(supplierLocations).where(eq(supplierLocations.supplierId, supplier.id));
      await db.delete(suppliers).where(eq(suppliers.id, supplier.id));
      await cleanup(f);
    }
  });
});

describe("quick-add authorization baseline observation", () => {
  it("F14: Member can insert through quick-add but canonical creation denies it", async () => {
    const member = { ...context, orgRole: "member" as const };
    const input = { code: `AUD-${crypto.randomUUID()}`, name: `Audit ${crypto.randomUUID()}`,
      category: "forestry" as const, usage: "pyrolysis" as const };
    await expect(canonicalCreateFeedstockType(member, input)).rejects.toThrow();
    const created = await quickCreateFeedstockType(member, input);
    try {
      expect(await db.select().from(feedstockTypes).where(eq(feedstockTypes.id, created.id))).toHaveLength(1);
      console.log("F14: canonical Member creation denied; quick-add Member creation persisted");
    } finally { await db.delete(feedstockTypes).where(eq(feedstockTypes.id, created.id)); }
  });
});
