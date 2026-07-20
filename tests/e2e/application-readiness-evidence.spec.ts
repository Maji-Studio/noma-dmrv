/**
 * Application certification readiness — shared evidence source (issue #246)
 *
 * Regression guard for the QA contradiction where an application listed
 * "Ready" for certification with every form field filled but ZERO application
 * evidence, while the removal wizard blocked it on that same missing evidence.
 *
 * The fix folds the application-evidence gap into the one shared readiness
 * decision (`deriveEntityCertifyReadiness`, fed by `applicationEvidenceGapCountSql`),
 * so the list badge and the wizard can no longer disagree on this entity-local
 * fact. This spec drives the UI end to end: a form-complete-but-evidence-missing
 * application must badge Incomplete (naming the evidence gap), and once qualifying
 * geotagged evidence exists the same badge must flip to Ready.
 */
import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as crypto from "crypto";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  selectFirstEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { APPLICATION_VISUAL_EVIDENCE_ROLES } from "../../src/lib/certification/application-evidence";

/**
 * Create Order → delivered Delivery → Application (all certify-relevant form
 * fields filled, visual evidence method, NO photos uploaded) and return the
 * unique field identifier used to locate the row / DB record.
 */
async function seedFormCompleteApplication(
  page: Page,
  seededData: SeededChainData,
): Promise<string> {
  const today = new Date().toISOString().split("T")[0]!;
  const fieldIdentifier = `E2E-EVID-${crypto.randomUUID().slice(0, 8)}`;

  // Order
  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("New Order")');
  await waitForSideSheet(page);
  await page.fill('input[name="orderDate"]', today);
  await page.selectOption('select[name="customerId"]', seededData.customer.id);
  await page.waitForSelector('select[name="customerLocationId"]:not([disabled])', {
    timeout: 8000,
  });
  await page.selectOption(
    'select[name="customerLocationId"]',
    seededData.customerLocation.id,
  );
  await selectEntity(
    page,
    "Biochar Product",
    seededData.biocharProduct.id,
    seededData.biocharProduct.code,
  );
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', "100");
  await page.locator('[role="dialog"]').locator('button:has-text("Create Order")').click();
  await waitForSideSheetClose(page);

  // Delivery (must be "delivered" before an application can reference it — #284)
  await page.goto(`/deliveries?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("New Delivery")');
  await waitForSideSheet(page);
  await page.fill('input[name="deliveryDate"]', today);
  await page.selectOption('select[name="status"]', "delivered");
  await selectFirstEntity(page, "Order");
  await page.fill('input[name="deliveredWetMassKg"]', "10000");
  await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
  await waitForSideSheetClose(page);

  // Application — every field the shared readiness decision requires for a
  // 200-year facility EXCEPT evidence: mass (wet + dry) and soil temperature.
  await page.goto(`/applications?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("New Application")');
  await waitForSideSheet(page);
  await page.fill('input[name="applicationDate"]', today);

  const deliverySelect = page.locator('select[name="deliveryId"]');
  const firstDeliveryValue = await deliverySelect
    .locator("option:not([value=''])")
    .first()
    .getAttribute("value");
  if (firstDeliveryValue) {
    await deliverySelect.selectOption(firstDeliveryValue);
  }

  await page.fill('input[name="biocharAppliedTons"]', "5000");
  await page.fill('input[name="biocharAppliedDryTons"]', "4500");
  await page.fill('input[name="fieldSizeHa"]', "2");
  await page.fill('input[name="fieldIdentifier"]', fieldIdentifier);
  await page.fill('input[name="cropType"]', "maize");
  // Soil temperature is a certify requirement for 200-year facilities.
  await page.fill('input[name="soilTemperatureC"]', "24");

  // Evidence method stays on the "visual" default; no photos are uploaded.
  await expect(
    page.locator('input[name="evidenceMethod"][value="visual"]'),
  ).toBeChecked();

  await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
  await waitForSideSheetClose(page);

  return fieldIdentifier;
}

test.describe("Application certification readiness reads the shared evidence source", () => {
  test("form-complete application badges Incomplete until evidence exists", async ({
    adminPage: page,
    seededData,
  }) => {
    const fieldIdentifier = await seedFormCompleteApplication(page, seededData);

    const applicationsUrl = `/applications?facility=${seededData.facility.id}`;
    await page.goto(applicationsUrl);
    await page.waitForLoadState("networkidle");

    const row = page.locator("table tbody tr").first();
    await expect(row).toBeVisible({ timeout: 10000 });

    // Every form field is filled, yet the certification badge must NOT read
    // "Ready": the missing visual evidence is a gap the shared decision counts.
    const incompleteBadge = row.getByRole("button", {
      name: /Incomplete for certification/,
    });
    await expect(incompleteBadge).toBeVisible();
    await expect(incompleteBadge).toContainText("Incomplete (1)");
    await expect(
      page.locator('[aria-label="Ready for certification"]'),
    ).toHaveCount(0);

    // The gap the badge reports is the evidence gap — the same fact the wizard
    // blocks on, proving the two derive from one source.
    await incompleteBadge.hover();
    await expect(
      page.getByText("Geotagged photos or boundary evidence required to certify"),
    ).toBeVisible({ timeout: 5000 });

    // Add qualifying geotagged evidence for all three visual stages, mirroring a
    // completed upload (uploaded photo docs carrying present-geotag metadata).
    const { db, pool } = createDbConnection();
    try {
      const [application] = await db
        .select({ id: schema.applications.id })
        .from(schema.applications)
        .where(
          and(
            eq(schema.applications.fieldIdentifier, fieldIdentifier),
            eq(schema.applications.organizationId, DEC_ORG_ID),
          ),
        )
        .limit(1);
      expect(application?.id).toBeTruthy();

      await db.insert(schema.documents).values(
        APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
          organizationId: DEC_ORG_ID,
          entityType: "application" as const,
          entityId: application!.id,
          documentType: "photo" as const,
          fileUrl: `https://evidence.example.test/${application!.id}/${role}.jpg`,
          fileName: `${role}.jpg`,
          uploadStatus: "uploaded" as const,
          metadata: { geotagStatus: "present", evidenceRole: role },
        })),
      );
    } finally {
      await pool.end();
    }

    // Reload for a fresh server-computed evidenceGapCount — the badge now agrees
    // the entity is certification-ready.
    await page.goto(applicationsUrl);
    await page.waitForLoadState("networkidle");
    const reloadedRow = page.locator("table tbody tr").first();
    await expect(
      reloadedRow.locator('[aria-label="Ready for certification"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /Incomplete for certification/ }),
    ).toHaveCount(0);
  });
});
