/**
 * Application certification readiness — shared evidence source (issue #246)
 *
 * Regression guard for the QA contradiction where the list badge and the
 * removal wizard disagreed about the same missing application evidence.
 *
 * The fix folds the application-evidence fact into the shared readiness
 * decision (`deriveEntityCertifyReadiness`, fed by
 * `applicationEvidenceGapCountSql`), so the list badge is evidence-aware for
 * this entity-local fact. Since #585 that fact is ADVISORY: missing evidence
 * never blocks certification or Removal submission, it only raises a warning.
 * This spec guards the list-badge side of that: a form-complete-but-evidence-
 * missing application badges Ready with one advisory warning that names the
 * gap, and once qualifying geotagged evidence exists the warning clears.
 *
 * Scope note: this spec asserts only the list badge. The wizard's server-side
 * gap computation (`buildApplicationEvidenceGaps`) is a separate implementation
 * that shares the `application-evidence` constants but not the SQL path;
 * guarding badge/wizard *agreement* is tracked in docs/open-questions.md.
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

test.describe("Application certification readiness reads the shared evidence source", () => {
  test("form-complete application badges an advisory warning until evidence exists", async ({
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

    // Every form field is filled and the missing visual evidence no longer
    // blocks certification (#585), so the badge reads Ready — but it must still
    // carry the evidence fact as an advisory warning rather than swallow it.
    const advisoryBadge = row.getByRole("button", {
      name: /Ready for certification with 1 warning/,
    });
    await expect(advisoryBadge).toBeVisible();
    await expect(advisoryBadge).toContainText("Ready (1 warning)");
    await expect(
      row.getByRole("button", { name: /Incomplete for certification/ }),
    ).toHaveCount(0);
    // The unqualified ready badge is a plain span with an exact aria-label; the
    // advisory one is a tooltip trigger, so this proves which variant rendered.
    await expect(
      page.locator('[aria-label="Ready for certification"]'),
    ).toHaveCount(0);

    // The warning the badge reports is the evidence warning — the same fact the
    // wizard now surfaces without blocking (see the scope note).
    await advisoryBadge.hover();
    await expect(
      page.getByText(
        "Advisory: Application evidence is incomplete. This does not block certification.",
      ),
    ).toBeVisible({ timeout: 5000 });

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

    // Reload for a fresh server-computed evidenceGapCount — the advisory
    // warning clears and the badge reads plain Ready.
    await page.goto(applicationsUrl);
    await page.waitForLoadState("networkidle");
    const reloadedRow = page.locator("table tbody tr", {
      hasText: applicationCode,
    });
    await expect(
      reloadedRow.locator('[aria-label="Ready for certification"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      reloadedRow.getByRole("button", { name: /Ready for certification with/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Incomplete for certification/ }),
    ).toHaveCount(0);
  });
});
