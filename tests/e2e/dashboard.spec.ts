import { supplierLocationFacilityDistances } from "@/db/schema";
import { cleanupFeedstockFixtureParents } from "../helpers/feedstock-fixture";
/**
 * Dashboard + credit-batch detail.
 *
 * Dashboard: the 4-stat KPI band, the stage band (landscape scene, six stage
 * cells, record actions), the bottom row (To do, Bins, Recent activity) and
 * the credit batch filter, all facility-scoped.
 * Credit batch detail: certification journey, cohort fields, carbon estimate,
 * readiness and lab samples, and the edit form in the unified view sheet.
 */
import { test, expect } from "./fixtures/auth-fixtures";
import {
  seedCreditBatch,
  seedCreditBatchProductionLineage,
} from "./fixtures/seed-chain-data";
import { seedCertifierMapping } from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { onboardingGuideCollapsedKey } from "@/components/onboarding/onboarding-constants";
import {
  facilities,
  feedstocks,
  storageLocations,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import { eq } from "drizzle-orm";

test.describe("Dashboard", () => {
  test("renders headline, KPI band, stage band, bottom row, and the credit batch filter", async ({
    adminPage,
    seededData,
  }) => {
    // This spec describes an operating facility's dashboard, so satisfy every
    // Setup step (registry link + complete run + credit batch on top of the
    // seeded chain) — otherwise the getting-started guide takes over the body.
    // Fixture teardown sweeps the certifier row along with the chain.
    await seedCertifierMapping(seededData.facility.id, {
      externalProjectId: `e2e-dash-${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedCreditBatchProductionLineage(
      seededData,
      crypto.randomUUID().slice(0, 8),
    );

    const page = adminPage;
    await page.goto(`/dashboard?facility=${seededData.facility.id}`);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 4-stat KPI band
    const kpis = page.getByTestId("dashboard-kpis");
    await expect(kpis).toBeVisible();
    await expect(kpis.getByText("Feedstock processed")).toBeVisible();
    await expect(kpis.getByText("Biochar produced")).toBeVisible();
    await expect(kpis.getByText("Applied to soil")).toBeVisible();
    await expect(kpis.getByText("Estimated CO₂e stored", { exact: true })).toBeVisible();
    // The popup has no tooltip role; count its exact text page-wide.
    const hintCopies = page.getByText(/biochar applied to soil/);
    const closedCount = await hintCopies.count();
    await kpis.getByRole("button", { name: "More about Applied to soil" }).click();
    await expect(hintCopies).toHaveCount(closedCount + 1);
    await page.keyboard.press("Escape");
    await expect(hintCopies).toHaveCount(closedCount);

    // Stage band: six stage cells, each opening its list
    const stages = page.getByRole("region", { name: "Traceability stages" });
    await expect(stages).toBeVisible();
    await expect(stages.getByRole("link", { name: /^Suppliers, .* Open Suppliers$/ })).toBeVisible();
    await expect(stages.getByRole("link", { name: /Open Production runs$/ })).toBeVisible();
    await expect(stages.getByRole("link", { name: "New supplier" })).toBeVisible();

    // Bottom row: To do | Bins | Recent activity
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bins" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

    // The credit batch filter replaces the period toggle
    await expect(page.getByRole("combobox", { name: "Filter by credit batch" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Week" })).toHaveCount(0);
  });

  test("structural certification gaps stay in To do under the credit batch filter and clear when fixed", async ({
    adminPage,
    seededData,
    testUsers,
  }) => {
    const { db, pool } = createDbConnection();
    const facilityId = crypto.randomUUID();
    const supplierId = crypto.randomUUID();
    const supplierLocationId = crypto.randomUUID();
    const storageLocationId = crypto.randomUUID();
    const feedstockId = crypto.randomUUID();
    const transportLegId = crypto.randomUUID();
    const tag = crypto.randomUUID().slice(0, 8);

    try {
      await db.transaction(async (tx) => {
        await tx.insert(facilities).values({ country: "Tanzania",  timezone: "UTC",
          id: facilityId,
          organizationId: DEC_ORG_ID,
          code: `E2E-DASH-GAP-${tag}`,
          name: `E2E Dashboard Gap ${tag}`,
          gpsLatitude: -6.163,
          gpsLongitude: 35.7516,
        });
        await tx.insert(suppliers).values({
          id: supplierId,
          organizationId: DEC_ORG_ID,
          code: `E2E-DASH-SUP-${tag}`,
          name: `E2E Dashboard Supplier ${tag}`,
        });
        await tx.insert(supplierLocations).values({
          gpsLongitude: 35.3,
          id: supplierLocationId,
          organizationId: DEC_ORG_ID,
          supplierId,
          name: "Source location awaiting default selection",
          country: "TZ",
          gpsLatitude: -6.8,
          isDefault: false,
        });
        await tx.insert(supplierLocationFacilityDistances).values({ organizationId: DEC_ORG_ID, locationId: supplierLocationId, facilityId, distanceKm: 25, distanceSource: "manual" });
        await tx.insert(storageLocations).values({
          id: storageLocationId,
          organizationId: DEC_ORG_ID,
          code: `E2E-DASH-SL-${tag}`,
          name: `E2E Dashboard Feedstock Bin ${tag}`,
          type: "feedstock_bin",
          facilityId,
          feedstockTypeId: seededData.feedstockType.id,
        });
        await tx.insert(feedstocks).values({
          id: feedstockId,
          organizationId: DEC_ORG_ID,
          code: `E2E-DASH-FS-${tag}`,
          facilityId,
          status: "complete",
          deliveryDate: new Date("2026-07-25T12:00:00.000Z"),
          supplierId,
          feedstockTypeId: seededData.feedstockType.id,
          massWetKg: 100,
          massDryKg: 90,
          moistureContentPercent: 10,
          storageLocationId,
        });
        await tx.insert(transportLegs).values({
          id: transportLegId,
          organizationId: DEC_ORG_ID,
          entityType: "feedstock",
          entityId: feedstockId,
          originGpsLatitude: null,
          originGpsLongitude: null,
          destinationGpsLatitude: -6.163,
          destinationGpsLongitude: 35.7516,
          distanceKm: 25,
          distanceSource: "manual",
          transportMethodType: "road",
          loadMassKg: 100,
          isDerived: true,
        });
      });

      const page = adminPage;
      // This ad-hoc facility is deliberately half-provisioned (no reactor,
      // registry, run, or batch), so the getting-started guide would take over
      // the dashboard body. Collapse it the way an operator would — the guide
      // recedes to a strip and the real dashboard renders.
      // The preference key is scoped per user + active org; cover both active-org
      // states the admin session may be in (entered DEC vs none).
      await page.addInitScript(
        (keys: string[]) => {
          for (const key of keys) window.localStorage.setItem(key, "true");
        },
        [
          onboardingGuideCollapsedKey(testUsers.admin.id, DEC_ORG_ID),
          onboardingGuideCollapsedKey(testUsers.admin.id, null),
        ],
      );
      await page.goto(`/dashboard?facility=${facilityId}`);
      const strip = page.getByRole("region", { name: "Getting started" });
      await expect(strip.getByRole("button", { name: "Register reactor" })).toBeVisible();
      await strip.getByRole("button", { name: "Register reactor" }).click();
      const reactorSheet = page.getByRole("dialog", { name: "Create reactor" });
      await expect(reactorSheet).toBeVisible();
      await reactorSheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(reactorSheet).not.toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/dashboard\\?facility=${facilityId}`));
      const structuralGaps = page.getByRole("list", { name: "To do" });
      await expect(structuralGaps.getByText("Supplier location GPS missing")).toBeVisible();
      await expect(
        structuralGaps.getByText("Feedstock route GPS missing"),
      ).toBeVisible();
      await expect(
        structuralGaps.getByText("Supplier form · Location · 1 affected"),
      ).toBeVisible();
      await expect(
        structuralGaps.getByText("Feedstock form · Transport route · 1 affected"),
      ).toBeVisible();
      await expect(page.getByText("Nothing to fix")).toHaveCount(0);

      await db.transaction(async (tx) => {
        await tx
          .update(supplierLocations)
          .set({ gpsLongitude: 39.28, isDefault: true })
          .where(eq(supplierLocations.id, supplierLocationId));
        await tx
          .update(transportLegs)
          .set({
            originGpsLatitude: -6.8,
            originGpsLongitude: 39.28,
          })
          .where(eq(transportLegs.id, transportLegId));
      });

      await page.reload();
      await expect(page.getByRole("list", { name: "To do" })).toHaveCount(0);
      await expect(page.getByText("Nothing to fix")).toBeVisible();
    } finally {
      await db.delete(transportLegs).where(eq(transportLegs.id, transportLegId));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
      await cleanupFeedstockFixtureParents(db);
      await db
        .delete(supplierLocations)
        .where(eq(supplierLocations.id, supplierLocationId));
      await db.delete(suppliers).where(eq(suppliers.id, supplierId));
      await db
        .delete(storageLocations)
        .where(eq(storageLocations.id, storageLocationId));
      await db.delete(facilities).where(eq(facilities.id, facilityId));
      await pool.end();
    }
  });
});

test.describe("Credit batch view sheet (Phase 5)", () => {
  test("the list sheet previews the batch, edits it and links to its page", async ({
    adminPage,
    seededData,
  }) => {
    const batch = await seedCreditBatch(
      seededData.facility.id,
      crypto.randomUUID().slice(0, 8),
      seededData.feedstockType.id,
    );
    const page = adminPage;
    await page.goto(`/credit-batches?facility=${seededData.facility.id}&batch=${batch.id}`);

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: batch.code })).toBeVisible();

    // Certification journey and cohort fields lead the view.
    await expect(
      sheet.getByText("Certification progress", { exact: true }),
    ).toBeVisible();
    // Sentence case (docs/design-system.md › Label casing); `exact: true` is
    // case-sensitive, so this string must match the UI's casing exactly.
    await expect(sheet.getByText("Feedstock type", { exact: true })).toBeVisible();
    // This fixture has no preview: no summary metric, and the derived figure is left out, not a placeholder.
    await expect(sheet.getByText("Estimated CO₂e stored", { exact: true })).toHaveCount(0);
    const carbonEstimate = sheet.getByRole("region", {
      name: "Carbon estimate, before project emissions",
      exact: true,
    });
    await expect(carbonEstimate).toBeVisible();
    await expect(carbonEstimate).not.toContainText("≈");
    await expect(carbonEstimate).not.toContainText("Not available");
    await expect(sheet.getByText("Durability", { exact: true })).toBeVisible();
    await expect(
      sheet.getByText("Production runs", { exact: true }),
    ).toBeVisible();

    // A preview: the checklist and Samples live on the batch page it links to.
    await expect(sheet.getByTestId("batch-health-strip")).toHaveCount(0);
    await expect(sheet.getByText("Lab Samples", { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "Open credit batch" })).toHaveAttribute(
      "href",
      `/credit-batches/${batch.id}?facility=${seededData.facility.id}`,
    );

    // Registry/accounting fields are deliberately absent; the form mounts only
    // after the footer edit action is used.
    await expect(sheet.getByText("Registry & accounting")).toHaveCount(0);
    await expect(page.locator("#startDate")).toHaveCount(0);

    // Footer edit swaps the sheet to the form; cancel closes the sheet.
    await sheet.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("#startDate")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#startDate")).toHaveCount(0);
  });
});
