/**
 * DB-backed tests for the energy read and the facility emission factors
 * (ADR 0031). Requires the real Postgres configured by the test environment.
 *
 * They execute every query the read composes (the delivery and application
 * run-share sums, the feedstock leg join, the effective-distance coalesce)
 * and pin the tenancy contract: another organization reads the facility as
 * empty and cannot write its factors.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  facilities,
  facilityEmissionFactors,
  feedstocks,
  productionRunFeedstocks,
  transportLegs,
} from "@/db/schema";
import { getEnergyInputs } from "@/data-access/energy";
import {
  getFacilityEmissionFactors,
  upsertFacilityEmissionFactors,
} from "@/data-access/facility-emission-factors";
import { buildEnergyBreakdown } from "@/lib/energy/attribution";
import { DomainError } from "@/lib/domain-errors";
import { STALE_VERSION_CONFLICT_CODE } from "@/lib/stale-version";
import {
  cleanupPostedStock,
  postDelivery,
  postedStockFixture,
} from "./helpers/posted-output-stock-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const DELIVERED_WET_KG = 200;
const FEEDSTOCK_WET_KG = 2_000;
const FEEDSTOCK_DRAW_KG = 500;
const LEG_KM = 12;
const FACTORS = {
  dieselKgCo2ePerLitre: 2.68,
  gridKgCo2ePerKwh: 0.45,
  roadFreightKgCo2ePerTonneKm: 0.107,
  sourceNote: "DEFRA 2024",
};

type Fixture = Awaited<ReturnType<typeof postedStockFixture>>;
let fixture: Fixture;
let feedstockId: string;

beforeAll(async () => {
  await ensureTestOrg();
  fixture = await postedStockFixture();
  await postDelivery(fixture, DELIVERED_WET_KG);
  const orgId = fixture.ctx.organizationId;
  const [feedstock] = await db
    .insert(feedstocks)
    .values({
      organizationId: orgId,
      facilityId: fixture.facility.id,
      code: `E2E-ENERGY-FS-${fixture.tag}`,
      feedstockTypeId: fixture.ingredientType.id,
      deliveryDate: new Date("2026-09-01T06:00:00Z"),
      massWetKg: FEEDSTOCK_WET_KG,
      massDryKg: FEEDSTOCK_WET_KG / 2,
    })
    .returning();
  feedstockId = feedstock.id;
  await db.insert(transportLegs).values({
    organizationId: orgId,
    entityType: "feedstock",
    entityId: feedstockId,
    distanceKm: LEG_KM,
    loadMassKg: FEEDSTOCK_WET_KG,
    transportMethodType: "road",
  });
  await db.insert(productionRunFeedstocks).values({
    organizationId: orgId,
    productionRunId: fixture.runs[0].id,
    feedstockId,
    wetMassUsedKg: FEEDSTOCK_DRAW_KG,
  });
});

afterAll(async () => {
  if (!fixture) return;
  const orgId = fixture.ctx.organizationId;
  await db.delete(facilityEmissionFactors).where(eq(facilityEmissionFactors.organizationId, orgId));
  await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.organizationId, orgId));
  await cleanupPostedStock(fixture);
});

describe.sequential("energy read", () => {
  it("loads the facility's runs, legs, draws, deliveries and run shares", async () => {
    const { inputs, timeZone } = await getEnergyInputs(fixture.ctx, fixture.facility.id);

    expect(timeZone).toBe("UTC");
    expect(inputs.runs.map((run) => run.id).sort()).toEqual(
      fixture.runs.map((run) => run.id).sort(),
    );
    expect(inputs.runs.find((run) => run.id === fixture.runs[0].id)?.day).toBe("2026-09-09");
    // The shared output-stock fixture adds its own fuel intake for valid run draws.
    expect(inputs.feedstocks.filter((row) => row.id === feedstockId)).toEqual([
      expect.objectContaining({
        id: feedstockId,
        day: "2026-09-01",
        wetMassKg: FEEDSTOCK_WET_KG,
        legs: [{ distanceKm: LEG_KM, loadMassKg: FEEDSTOCK_WET_KG, method: "road" }],
      }),
    ]);
    expect(inputs.feedstockDraws.filter((draw) => draw.feedstockId === feedstockId)).toEqual([
      { runId: fixture.runs[0].id, feedstockId, wetMassKg: FEEDSTOCK_DRAW_KG },
    ]);

    expect(inputs.deliveries).toHaveLength(1);
    const [delivery] = inputs.deliveries;
    expect(delivery.deliveredWetMassKg).toBe(DELIVERED_WET_KG);
    // No customer location on the fixture order: the distance is unknown, not zero.
    expect(delivery.effectiveDistanceKm).toBeNull();
    const sharedDryKg = inputs.deliveryRunShares
      .filter((share) => share.ownerId === delivery.id)
      .reduce((total, share) => total + share.dryMassKg, 0);
    expect(sharedDryKg).toBeCloseTo(delivery.massDryKg ?? Number.NaN, 3);
    expect(inputs.applications).toEqual([]);
    expect(inputs.applicationRunShares).toEqual([]);
  });

  it("reads application and feedstock calendar days as entered, west of UTC", async () => {
    const [delivery] = (await getEnergyInputs(fixture.ctx, fixture.facility.id)).inputs.deliveries;
    const [feedstockBefore] = await db
      .select({ deliveryDate: feedstocks.deliveryDate })
      .from(feedstocks)
      .where(eq(feedstocks.id, feedstockId));
    // Date-only inputs are stored as the chosen day at UTC midnight.
    await db.update(feedstocks).set({ deliveryDate: new Date("2026-09-01") }).where(eq(feedstocks.id, feedstockId));
    await db.update(facilities).set({ timezone: "America/Sao_Paulo" }).where(eq(facilities.id, fixture.facility.id));
    const [application] = await db
      .insert(applications)
      .values({
        organizationId: fixture.ctx.organizationId,
        code: `E2E-ENERGY-AP-${fixture.tag}`,
        applicationDate: new Date("2026-09-15"),
        deliveryId: delivery.id,
        biocharAppliedTons: 0.1,
        biocharAppliedDryTons: 0.05,
      })
      .returning({ id: applications.id });
    try {
      const { inputs, timeZone } = await getEnergyInputs(fixture.ctx, fixture.facility.id);
      expect(timeZone).toBe("America/Sao_Paulo");
      expect(inputs.applications.find((row) => row.id === application.id)?.day).toBe("2026-09-15");
      expect(inputs.feedstocks.find((row) => row.id === feedstockId)?.day).toBe("2026-09-01");
    } finally {
      await db.delete(applications).where(eq(applications.id, application.id));
      await db.update(facilities).set({ timezone: "UTC" }).where(eq(facilities.id, fixture.facility.id));
      await db
        .update(feedstocks)
        .set({ deliveryDate: feedstockBefore.deliveryDate })
        .where(eq(feedstocks.id, feedstockId));
    }
  });

  it("reads another organization's facility as empty", async () => {
    const foreign = makeTestOrgContext();
    const { inputs } = await getEnergyInputs(foreign, fixture.facility.id);
    expect(Object.values(inputs).every((rows) => rows.length === 0)).toBe(true);
  });

  it("feeds the attribution: the delivery carries its runs' production share", async () => {
    const { inputs } = await getEnergyInputs(fixture.ctx, fixture.facility.id);
    const breakdown = buildEnergyBreakdown(inputs, null, { from: null, to: "2026-12-31" });
    const delivery = breakdown.records.find((record) => record.scope === "delivery");
    expect(delivery?.runCount).toBeGreaterThan(0);
    expect(delivery?.footprint.gaps.biocharTransport).toEqual({ missing: 1, of: 1, unit: "delivery", recorded: false });
    const run = breakdown.records.find((record) => record.id === fixture.runs[0].id);
    expect(run?.footprint.activity.feedstockTransport).toBeCloseTo(
      2 * LEG_KM * (FEEDSTOCK_WET_KG / 1000) * (FEEDSTOCK_DRAW_KG / FEEDSTOCK_WET_KG),
    );
  });
});

describe.sequential("facility emission factors", () => {
  it("reads null until saved, then round-trips and updates in place", async () => {
    await expect(getFacilityEmissionFactors(fixture.ctx, fixture.facility.id)).resolves.toBeNull();

    const first = await upsertFacilityEmissionFactors(fixture.ctx, { facilityId: fixture.facility.id, ...FACTORS, expectedVersion: null });
    await upsertFacilityEmissionFactors(fixture.ctx, {
      facilityId: fixture.facility.id,
      ...FACTORS,
      gridKgCo2ePerKwh: 0.5,
      expectedVersion: first.version,
    });

    const saved = await getFacilityEmissionFactors(fixture.ctx, fixture.facility.id);
    expect(saved).toMatchObject({ ...FACTORS, gridKgCo2ePerKwh: 0.5 });
    const rows = await db
      .select({ id: facilityEmissionFactors.id })
      .from(facilityEmissionFactors)
      .where(eq(facilityEmissionFactors.facilityId, fixture.facility.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses a save built on a stale version, and a second first save", async () => {
    const saved = await getFacilityEmissionFactors(fixture.ctx, fixture.facility.id);
    if (!saved) throw new Error("expected saved factors");
    const opened = saved.version;

    const fresh = await upsertFacilityEmissionFactors(fixture.ctx, {
      facilityId: fixture.facility.id,
      ...FACTORS,
      gridKgCo2ePerKwh: 0.6,
      expectedVersion: opened,
    });
    expect(fresh.gridKgCo2ePerKwh).toBe(0.6);

    const staleSave = upsertFacilityEmissionFactors(fixture.ctx, {
      facilityId: fixture.facility.id,
      ...FACTORS,
      gridKgCo2ePerKwh: 0.7,
      expectedVersion: opened,
    });
    await expect(staleSave).rejects.toBeInstanceOf(DomainError);
    await expect(staleSave).rejects.toMatchObject({
      conflict: { code: STALE_VERSION_CONFLICT_CODE },
    });

    // A form that opened on no row must not overwrite a row saved since.
    await expect(
      upsertFacilityEmissionFactors(fixture.ctx, {
        facilityId: fixture.facility.id,
        ...FACTORS,
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ conflict: { code: STALE_VERSION_CONFLICT_CODE } });
    await expect(getFacilityEmissionFactors(fixture.ctx, fixture.facility.id)).resolves.toMatchObject({
      gridKgCo2ePerKwh: 0.6,
    });
  });

  it("lets only one of two concurrent first saves win", async () => {
    await db.delete(facilityEmissionFactors).where(eq(facilityEmissionFactors.facilityId, fixture.facility.id));
    const first = (grid: number) =>
      upsertFacilityEmissionFactors(fixture.ctx, {
        facilityId: fixture.facility.id,
        ...FACTORS,
        gridKgCo2ePerKwh: grid,
        expectedVersion: null,
      });
    const results = await Promise.allSettled([first(0.31), first(0.32)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [refused] = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(refused.reason).toMatchObject({ conflict: { code: STALE_VERSION_CONFLICT_CODE } });
  });

  it("hides the factors from another organization and refuses its write", async () => {
    const foreign = makeTestOrgContext();
    await expect(getFacilityEmissionFactors(foreign, fixture.facility.id)).resolves.toBeNull();
    await expect(
      upsertFacilityEmissionFactors(foreign, { facilityId: fixture.facility.id, ...FACTORS, expectedVersion: null }),
    ).rejects.toThrow();
  });

  it("refuses a save for an archived facility", async () => {
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, fixture.facility.id));
    try {
      await expect(
        upsertFacilityEmissionFactors(fixture.ctx, {
          facilityId: fixture.facility.id,
          ...FACTORS,
          expectedVersion: null,
        }),
      ).rejects.toThrow("Facility was not found or is archived.");
    } finally {
      await db.update(facilities).set({ archivedAt: null }).where(eq(facilities.id, fixture.facility.id));
    }
  });

  it("refuses a member below Admin", async () => {
    await expect(
      upsertFacilityEmissionFactors(
        { ...fixture.ctx, orgRole: "member" },
        { facilityId: fixture.facility.id, ...FACTORS, expectedVersion: null },
      ),
    ).rejects.toThrow();
  });
});
