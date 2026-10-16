import { feedstockFixtureValues } from "./helpers/feedstock-fixture";
/**
 * DB-backed tests for the energy read (ADR 0031). Requires the real Postgres configured by the test environment.
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
  feedstocks,
  productionRunFeedstocks,
  transportLegs,
} from "@/db/schema";
import { getEnergyInputs } from "@/data-access/energy";
import { buildEnergyBreakdown } from "@/lib/energy/attribution";
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
    .values(await feedstockFixtureValues(db, {
      organizationId: orgId,
      facilityId: fixture.facility.id,
      code: `E2E-ENERGY-FS-${fixture.tag}`,
      feedstockTypeId: fixture.ingredientType.id,
      deliveryDate: new Date("2026-09-01T06:00:00Z"),
      massWetKg: FEEDSTOCK_WET_KG,
      massDryKg: FEEDSTOCK_WET_KG / 2,
    }))
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
        fieldSizeHa: 1,
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
    const breakdown = buildEnergyBreakdown(inputs, { from: null, to: "2026-12-31" });
    const delivery = breakdown.records.find((record) => record.scope === "delivery");
    expect(delivery?.runCount).toBeGreaterThan(0);
    expect(delivery?.footprint.gaps.biocharTransport).toEqual({ missing: 1, of: 1, unit: "delivery", recorded: false });
    const run = breakdown.records.find((record) => record.id === fixture.runs[0].id);
    expect(run?.footprint.activity.feedstockTransport).toBeCloseTo(
      2 * LEG_KM * (FEEDSTOCK_WET_KG / 1000) * (FEEDSTOCK_DRAW_KG / FEEDSTOCK_WET_KG),
    );
  });
});
