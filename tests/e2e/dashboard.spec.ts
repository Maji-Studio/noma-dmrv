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
  documents,
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
    testUsers,
  }) => {
    const { db, pool } = createDbConnection();
    const facilityId = crypto.randomUUID();
    const supplierId = crypto.randomUUID();
    const supplierLocationId = crypto.randomUUID();
    const feedstockId = crypto.randomUUID();
    const transportLegId = crypto.randomUUID();
    const evidenceDocumentId = crypto.randomUUID();
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
          isDefault: true,
        });
        await tx.insert(feedstocks).values({
          id: feedstockId,
          organizationId: DEC_ORG_ID,
          code: `E2E-DASH-FS-${tag}`,
          facilityId,
          status: "complete",
          supplierId,
          feedstockTypeId: seededData.feedstockType.id,
          massWetKg: 100,
          massDryKg: 90,
          moistureContentPercent: 10,
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
        structuralGaps.getByText("Transport distance lacks document evidence"),
      ).toBeVisible();
      await expect(structuralGaps.getByText("1 gap")).toHaveCount(3);
      await expect(page.getByText("3 open", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("All clear")).toHaveCount(0);

      const evidenceLink = structuralGaps.getByRole("link", {
        name: /Transport distance lacks document evidence/,
      });
      await expect(evidenceLink).toHaveAttribute(
        "href",
        `/feedstocks?facility=${facilityId}&feedstock=${feedstockId}&mode=edit&focus=transport-evidence`,
      );
      await evidenceLink.click();
      const feedstockSheet = page.getByRole("dialog");
      await expect(feedstockSheet.getByText("Save Changes")).toBeVisible();
      await expect(
        feedstockSheet.getByText(
          "Mark the saved distance source as Document and attach supporting evidence",
        ),
      ).toBeVisible();
      await expect(
        feedstockSheet.getByRole("radio", { name: "Bill of lading" }),
      ).toBeChecked();
      await expect(
        feedstockSheet.getByRole("radio", { name: "Weigh-scale ticket" }),
      ).toBeVisible();
      await expect(
        feedstockSheet.getByRole("radio", { name: "Other transport evidence" }),
      ).toBeVisible();
      await expect(
        feedstockSheet.getByText("Drop files here or click to upload"),
      ).toHaveCount(1);
      await feedstockSheet
        .getByRole("button", { name: "Use Document provenance" })
        .click();
      await expect(feedstockSheet.getByText(/Draft: Document/)).toBeVisible();
      await feedstockSheet
        .getByRole("button", { name: "About transport evidence" })
        .hover();
      await expect(
        page.getByText(
          "Transport evidence requires saved Document provenance plus at least one uploaded bill of lading, weigh-scale ticket, or other transport evidence file. One accepted file is enough. Uploading does not change the saved provenance.",
        ),
      ).toBeVisible();

      await page.goto(`/dashboard?facility=${facilityId}`);

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
            distanceSource: "document",
          })
          .where(eq(transportLegs.id, transportLegId));
        await tx.insert(documents).values({
          id: evidenceDocumentId,
          organizationId: DEC_ORG_ID,
          entityType: "feedstock",
          entityId: feedstockId,
          documentType: "bill_of_lading",
          fileName: "transport-evidence.pdf",
          fileUrl: "https://example.invalid/transport-evidence.pdf",
          uploadStatus: "uploaded",
        });
      });

      await page.reload();
      await expect(page.getByTestId("structural-gap-list")).toHaveCount(0);
      await expect(page.getByText("All clear")).toBeVisible();
      await expect(page.getByText("Every blocking check passes.")).toBeVisible();
    } finally {
      await db.delete(documents).where(eq(documents.id, evidenceDocumentId));
      await db.delete(transportLegs).where(eq(transportLegs.id, transportLegId));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
      await db
        .delete(supplierLocations)
        .where(eq(supplierLocations.id, supplierLocationId));
      await db.delete(suppliers).where(eq(suppliers.id, supplierId));
      await db.delete(facilities).where(eq(facilities.id, facilityId));
      await pool.end();
    }
  });
});

test.describe("Credit batch detail (Phase 5)", () => {
  test("compact overview, readiness panels, and edit sheet", async ({
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

    // Detail header: code and period, without repeating the facility name.
    await expect(page.getByRole("heading", { name: batch.code })).toBeVisible();
    await expect(
      page.locator(".container-max").getByText(seededData.facility.name),
    ).toHaveCount(0);

    // Compact overview keeps operational cohort fields at the top.
    const details = page.locator("#batch-details");
    await expect(details.getByText("Feedstock", { exact: true })).toBeVisible();
    await expect(details.getByText("CO₂e stored", { exact: true })).toBeVisible();
    await expect(details.getByText("Durability", { exact: true })).toBeVisible();
    await expect(details.getByText("Production runs", { exact: true })).toBeVisible();

    // Readiness and lab samples are the two primary panels below the overview.
    await expect(page.getByTestId("batch-health-strip")).toBeVisible();
    await expect(page.getByText("Certification readiness")).toBeVisible();
    await expect(page.getByText("Lab samples", { exact: true })).toBeVisible();

    // Registry/accounting fields are deliberately absent; the form mounts only
    // after the one page-level edit action is used.
    await expect(page.getByText("Registry & accounting")).toHaveCount(0);
    await expect(page.locator("#startDate")).toHaveCount(0);

    // Header edit opens the side-sheet form; cancel closes it again
    await page.getByRole("button", { name: "Edit batch" }).click();
    await expect(page.locator("#startDate")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#startDate")).toHaveCount(0);
  });
});
