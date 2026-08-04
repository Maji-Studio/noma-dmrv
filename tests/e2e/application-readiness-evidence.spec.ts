/**
 * Application evidence is retained independently from certification readiness.
 *
 * A form-complete Application remains ready with no evidence attachment. Adding
 * qualifying visual evidence records must not change that certification state.
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
 * fields filled, then switched to the legacy visual evidence method in the
 * fixture setup with NO photos uploaded) and return the
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
    "Product bin",
    seededData.biocharProduct.id,
    seededData.biocharProduct.code,
  );
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', "10000");
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
  await page.fill('input[name="moistureContentPercent"]', "10");
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
  await page.fill('input[name="fieldSizeHa"]', "2");
  await page.fill('input[name="fieldIdentifier"]', fieldIdentifier);
  await page.fill('input[name="cropType"]', "maize");
  // Soil temperature is a certify requirement for 200-year facilities.
  await page.fill('input[name="soilTemperatureC"]', "24");

  // New applications use the selectable GIS path. The test switches the saved
  // record to the still-supported visual path below, because that path is
  // locked only in the UI.
  await expect(
    page.getByRole("radio", { name: /GIS reference/ }),
  ).toBeChecked();

  await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
  await waitForSideSheetClose(page);

  return fieldIdentifier;
}

test.describe("Application evidence does not gate certification", () => {
  test("form-complete application stays ready before and after evidence is added", async ({
    adminPage: page,
    seededData,
  }) => {
    const fieldIdentifier = await seedFormCompleteApplication(page, seededData);

    // Resolve this application's identity (id for the evidence insert, code to
    // locate its row) once, up front — so row assertions target THIS entity by
    // its visible code, not by table position. A stale row from a failed
    // cleanup must never be asserted against by accident.
    let applicationId: string;
    let applicationCode: string;
    {
      const { db, pool } = createDbConnection();
      try {
        const [application] = await db
          .select({
            id: schema.applications.id,
            code: schema.applications.code,
          })
          .from(schema.applications)
          .where(
            and(
              eq(schema.applications.fieldIdentifier, fieldIdentifier),
              eq(schema.applications.organizationId, DEC_ORG_ID),
            ),
          )
          .limit(1);
        expect(application?.id).toBeTruthy();
        applicationId = application!.id;
        applicationCode = application!.code;
        await db
          .update(schema.applications)
          .set({ evidenceMethod: "visual" })
          .where(eq(schema.applications.id, applicationId));
      } finally {
        await pool.end();
      }
    }

    const applicationsUrl = `/applications?facility=${seededData.facility.id}`;
    await page.goto(applicationsUrl);
    await page.waitForLoadState("networkidle");

    const row = page.locator("table tbody tr", { hasText: applicationCode });
    await expect(row).toBeVisible({ timeout: 10000 });

    await expect(
      row.locator('[aria-label="Ready for certification"]'),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: /Incomplete for certification/ }),
    ).toHaveCount(0);

    // Add qualifying geotagged evidence for all three visual stages, mirroring a
    // completed upload (uploaded photo docs carrying present-geotag metadata).
    const { db, pool } = createDbConnection();
    try {
      await db.insert(schema.documents).values(
        APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
          organizationId: DEC_ORG_ID,
          entityType: "application" as const,
          entityId: applicationId,
          documentType: "photo" as const,
          fileUrl: `https://evidence.example.test/${applicationId}/${role}.jpg`,
          fileName: `${role}.jpg`,
          uploadStatus: "uploaded" as const,
          metadata: { geotagStatus: "present", evidenceRole: role },
        })),
      );
    } finally {
      await pool.end();
    }

    // Reload after evidence health changes. Certification remains independent.
    await page.goto(applicationsUrl);
    await page.waitForLoadState("networkidle");
    const reloadedRow = page.locator("table tbody tr", {
      hasText: applicationCode,
    });
    await expect(
      reloadedRow.locator('[aria-label="Ready for certification"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /Incomplete for certification/ }),
    ).toHaveCount(0);
  });
});
