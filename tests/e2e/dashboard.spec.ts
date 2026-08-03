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

test.describe("Dashboard (Flow Hero)", () => {
  test("renders headline, KPI band, hero views, supporting panels, and the period toggle", async ({
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
    await expect(hero.getByText("Traceability: supplier to soil")).toBeVisible();
    const attentionView = hero.getByRole("button", { name: "Needs attention" });
    await attentionView.click();
    await expect(attentionView).toHaveAttribute("aria-pressed", "true");
    await hero.getByRole("button", { name: "Overview" }).click();

    // Supporting row
    await expect(page.getByText("Needs attention", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Recent activity")).toBeVisible();
    await expect(page.getByText("Certification: credit batches")).toBeVisible();

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
        await tx.insert(facilities).values({
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
          id: supplierLocationId,
          organizationId: DEC_ORG_ID,
          supplierId,
          name: "Incomplete source location",
          country: "TZ",
          gpsLatitude: -6.8,
          distanceFromFacilityKm: 25,
          distanceSource: "manual",
          isDefault: true,
        });
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
      const structuralGaps = page.getByTestId("structural-gap-list");
      await expect(structuralGaps.getByText("Feedstock GPS missing")).toBeVisible();
      await expect(
        structuralGaps.getByText("Transport endpoint GPS missing"),
      ).toBeVisible();
      await expect(
        structuralGaps.getByText("Supplier form · Location · 1 affected"),
      ).toBeVisible();
      await expect(
        structuralGaps.getByText("Feedstock form · Transport route · 1 affected"),
      ).toBeVisible();
      await expect(
        page.getByText("2 open", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("All clear")).toHaveCount(0);

      await db.transaction(async (tx) => {
        await tx
          .update(supplierLocations)
          .set({ gpsLongitude: 39.28 })
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
      await expect(page.getByTestId("structural-gap-list")).toHaveCount(0);
      await expect(page.getByText("All clear")).toBeVisible();
      await expect(page.getByText("Every blocking check passes.")).toBeVisible();
    } finally {
      await db.delete(transportLegs).where(eq(transportLegs.id, transportLegId));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
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
  test("retired detail route opens the view sheet with sections and edit mode", async ({
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

    // The old detail URL redirects into the list's deep-linked view sheet.
    await expect(page).toHaveURL(new RegExp(`[?&]batch=${batch.id}`));
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: batch.code })).toBeVisible();

    // Certification journey and cohort fields lead the view.
    await expect(
      sheet.getByText("Certification progress", { exact: true }),
    ).toBeVisible();
    // Sentence case (docs/design-system.md › Label casing); `exact: true` is
    // case-sensitive, so this string must match the UI's casing exactly.
    await expect(sheet.getByText("Feedstock type", { exact: true })).toBeVisible();
    await expect(sheet.getByText("CO₂e stored", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Durability", { exact: true })).toBeVisible();
    await expect(
      sheet.getByText("Production runs", { exact: true }),
    ).toBeVisible();

    // Readiness and lab samples render below the sections.
    await expect(sheet.getByTestId("batch-health-strip")).toBeVisible();
    await expect(sheet.getByText("Certification requirements")).toBeVisible();
    await expect(sheet.getByText("Lab Samples", { exact: true })).toBeVisible();

    // Registry/accounting fields are deliberately absent; the form mounts only
    // after the footer edit action is used.
    await expect(sheet.getByText("Registry & accounting")).toHaveCount(0);
    await expect(page.locator("#startDate")).toHaveCount(0);

    // Footer edit swaps the sheet to the form; cancel closes the sheet.
    await sheet.getByRole("button", { name: "Edit Credit Batch" }).click();
    await expect(page.locator("#startDate")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#startDate")).toHaveCount(0);
  });
});
