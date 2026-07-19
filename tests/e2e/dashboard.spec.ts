/**
 * Dashboard + credit-batch detail.
 *
 * Dashboard (Flow Hero): the 4-stat KPI band, the isometric traceability hero
 * with its Overview / Flow / Needs-attention views, the supporting row
 * (needs-attention list, recent activity, certification block), and the
 * Week / Month / All period toggle — all facility-scoped.
 * Credit batch detail: header KPI row (CO₂e stored · lab samples · runs),
 * certification checklist strip, read-only Details card, and the edit form
 * behind the header's "Edit batch" side sheet.
 */
import { test, expect } from "./fixtures/auth-fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import { createDbConnection } from "./fixtures/db";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { facilities, feedstocks, transportLegs } from "@/db/schema";
import { eq } from "drizzle-orm";

test.describe("Dashboard (Flow Hero)", () => {
  test("renders headline, KPI band, hero views, supporting panels, and the period toggle", async ({
    adminPage,
    seededData,
  }) => {
    const page = adminPage;
    await page.goto(`/dashboard?facility=${seededData.facility.id}`);

    // Display headline with the facility riding in the eyebrow
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText(seededData.facility.name).first()).toBeVisible();

    // 4-stat KPI band
    const kpis = page.getByTestId("dashboard-kpis");
    await expect(kpis).toBeVisible();
    await expect(kpis.getByText("Feedstock processed")).toBeVisible();
    await expect(kpis.getByText("Biochar produced")).toBeVisible();
    await expect(kpis.getByText("Applied to soil")).toBeVisible();
    await expect(kpis.getByText("CO₂e stored")).toBeVisible();

    // Traceability hero with the smart-view segmented control
    const hero = page.getByTestId("flow-hero");
    await expect(hero).toBeVisible();
    await expect(hero.getByText("Traceability — supplier to soil")).toBeVisible();
    const attentionView = hero.getByRole("button", { name: "Needs attention" });
    await attentionView.click();
    await expect(attentionView).toHaveAttribute("aria-pressed", "true");
    await hero.getByRole("button", { name: "Overview" }).click();

    // Supporting row
    await expect(page.getByText("Needs attention", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Recent activity")).toBeVisible();
    await expect(page.getByText("Certification — credit batches")).toBeVisible();

    // Period toggle switches the active segment
    const week = page.getByRole("button", { name: "Week" });
    await week.click();
    await expect(week).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("structural certification gaps block false green while a zero-gap facility is all clear", async ({
    adminPage,
    seededData,
  }) => {
    const { db, pool } = createDbConnection();
    const clearFacilityId = crypto.randomUUID();
    const transportLegId = crypto.randomUUID();
    const tag = crypto.randomUUID().slice(0, 8);
    let originalFeedstockGps:
      | Pick<
          typeof feedstocks.$inferSelect,
          "gpsLatitude" | "gpsLongitude"
        >
      | undefined;

    try {
      [originalFeedstockGps] = await db
        .select({
          gpsLatitude: feedstocks.gpsLatitude,
          gpsLongitude: feedstocks.gpsLongitude,
        })
        .from(feedstocks)
        .where(eq(feedstocks.id, seededData.feedstock.id))
        .limit(1);

      await db.transaction(async (tx) => {
        await tx
          .update(facilities)
          .set({ gpsLatitude: null, gpsLongitude: null })
          .where(eq(facilities.id, seededData.facility.id));
        await tx
          .update(feedstocks)
          .set({ gpsLatitude: null, gpsLongitude: null })
          .where(eq(feedstocks.id, seededData.feedstock.id));
        await tx.insert(transportLegs).values({
          id: transportLegId,
          organizationId: DEC_ORG_ID,
          entityType: "feedstock",
          entityId: seededData.feedstock.id,
          originGpsLatitude: null,
          originGpsLongitude: null,
          destinationGpsLatitude: -6.163,
          destinationGpsLongitude: 35.7516,
          distanceKm: 25,
          distanceSource: "manual",
          transportMethodType: "road",
          loadMassKg: 100,
        });
        await tx.insert(facilities).values({
          id: clearFacilityId,
          organizationId: DEC_ORG_ID,
          code: `E2E-DASH-CLEAR-${tag}`,
          name: `E2E Dashboard Clear ${tag}`,
          gpsLatitude: -6.163,
          gpsLongitude: 35.7516,
        });
      });

      const page = adminPage;
      await page.goto(`/dashboard?facility=${seededData.facility.id}`);
      const structuralGaps = page.getByTestId("structural-gap-list");
      await expect(structuralGaps.getByText("Facility GPS missing")).toBeVisible();
      await expect(structuralGaps.getByText("Feedstock GPS missing")).toBeVisible();
      await expect(
        structuralGaps.getByText("Transport endpoint GPS missing"),
      ).toBeVisible();
      await expect(
        structuralGaps.getByText("Transport distance lacks document evidence"),
      ).toBeVisible();
      await expect(page.getByText("All clear")).toHaveCount(0);

      await page.goto(`/dashboard?facility=${clearFacilityId}`);
      await expect(page.getByText("All clear")).toBeVisible();
      await expect(page.getByText("Every record check passes.")).toBeVisible();
    } finally {
      await db.delete(transportLegs).where(eq(transportLegs.id, transportLegId));
      await db.delete(facilities).where(eq(facilities.id, clearFacilityId));
      await db
        .update(facilities)
        .set({ gpsLatitude: -6.163, gpsLongitude: 35.7516 })
        .where(eq(facilities.id, seededData.facility.id));
      if (originalFeedstockGps) {
        await db
          .update(feedstocks)
          .set(originalFeedstockGps)
          .where(eq(feedstocks.id, seededData.feedstock.id));
      }
      await pool.end();
    }
  });
});

test.describe("Credit batch detail (Phase 5)", () => {
  test("header KPI row, checklist strip, and read-only details with edit sheet", async ({
    adminPage,
    seededData,
  }) => {
    const batch = await seedCreditBatch(
      seededData.facility.id,
      crypto.randomUUID().slice(0, 8),
      seededData.feedstockType.id,
    );
    const page = adminPage;
    await page.goto(`/credit-batches/${batch.id}`);

    // Detail header: code as title, status badge alongside
    await expect(page.getByRole("heading", { name: batch.code })).toBeVisible();

    // KPI row: CO₂e stored · lab samples toward the ≥3 minimum · runs
    const kpis = page.getByTestId("batch-kpis");
    await expect(kpis.getByText("CO₂e stored")).toBeVisible();
    await expect(kpis.getByText("Lab samples")).toBeVisible();
    await expect(kpis.getByText("Production runs")).toBeVisible();

    // Certification checklist strip
    await expect(page.getByTestId("batch-health-strip")).toBeVisible();
    await expect(page.getByText("Certification checklist")).toBeVisible();

    // Read-only details card — the edit form (date inputs) is not mounted
    await expect(page.getByText("Registry & accounting")).toBeVisible();
    await expect(page.locator("#startDate")).toHaveCount(0);

    // Header edit opens the side-sheet form; cancel closes it again
    await page.getByRole("button", { name: "Edit batch" }).click();
    await expect(page.locator("#startDate")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#startDate")).toHaveCount(0);
  });
});
