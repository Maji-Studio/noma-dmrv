import { test, expect } from "./fixtures";
import {
  selectEntity,
  selectFirstEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

const COLD_COMPILE_TIMEOUT_MS = 30_000;
const FIRST_BOUNDARY_FILE = "e2e-upload-boundary.geojson";
/** The summary's "Areas" and "Shapes" values, whole-string. */
const SUMMARY_AREAS = /^1 area, [\d.]+ ha$/;
const SUMMARY_SHAPES = /^1 polygon, 5 vertices$/;
const UPLOAD_BOUNDARY = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "E2E upload area" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [39.27, -6.81],
            [39.29, -6.81],
            [39.29, -6.79],
            [39.27, -6.79],
            [39.27, -6.81],
          ],
        ],
      },
    },
  ],
};
const PASTE_BOUNDARY = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "E2E pasted replacement" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [39.3, -6.82],
            [39.32, -6.82],
            [39.32, -6.8],
            [39.3, -6.8],
            [39.3, -6.82],
          ],
        ],
      },
    },
  ],
};

test("adds, reads, replaces, and removes a GIS boundary", async ({
  adminPage: page,
  seededData,
}) => {
  const today = new Date().toISOString().split("T")[0];
  const applicationsUrl = `/applications?facility=${seededData.facility.id}`;
  const fieldIdentifier = `E2E GIS ${seededData.facility.code}`;

  await page.goto(`/orders?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New Order" }).click();
  await waitForSideSheet(page);
  await page.locator("#orderDate").fill(today);
  await page.locator("#customerId").selectOption(seededData.customer.id);
  await page.waitForSelector(
    'select[name="customerLocationId"]:not([disabled])',
    { timeout: COLD_COMPILE_TIMEOUT_MS },
  );
  await page
    .locator("#customerLocationId")
    .selectOption(seededData.customerLocation.id);
  await selectEntity(
    page,
    "Product bin",
    seededData.biocharProduct.id,
    seededData.biocharProduct.code,
  );
  await page.locator("#packaging").selectOption("loose");
  await page.locator("#quantityKg").fill("100");
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Create Order" })
    .click();
  await waitForSideSheetClose(page);

  await page.goto(`/deliveries?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New Delivery" }).click();
  await waitForSideSheet(page);
  await page.locator("#deliveryDate").fill(today);
  await page.locator("#status").selectOption("delivered");
  await selectFirstEntity(page, "Order");
  await page.locator("#deliveredWetMassKg").fill("100");
  await page.locator("#moistureContentPercent").fill("10");
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Create Delivery" })
    .click();
  await waitForSideSheetClose(page);

  await page.goto(applicationsUrl);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New Application" }).click();
  await waitForSideSheet(page);
  await page.locator("#applicationDate").fill(today);
  const deliverySelect = page.locator("#deliveryId");
  const deliveryValue = await deliverySelect
    .locator("option:not([value=''])")
    .first()
    .getAttribute("value");
  expect(deliveryValue).not.toBeNull();
  if (!deliveryValue) throw new Error("No delivered delivery was available");
  await deliverySelect.selectOption(deliveryValue);
  await page.locator("#biocharAppliedTons").fill("50");
  await page.locator("#fieldSizeHa").fill("2");
  await page.locator("#fieldIdentifier").fill(fieldIdentifier);

  await page.getByRole("radio", { name: /GIS reference/ }).click();
  await page.getByRole("button", { name: /Add GIS reference/ }).click();
  await page.locator("#gis-reference-file").setInputFiles({
    name: FIRST_BOUNDARY_FILE,
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(UPLOAD_BOUNDARY)),
  });
  // The dialog confirms the parse as "<file> (1 area)"; the saved summary
  // prints the file name on its own. Match them separately so the assertion
  // after Save cannot pass on a dialog that has not closed yet.
  await expect(
    page.getByText(`${FIRST_BOUNDARY_FILE} (`, { exact: false }),
  ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText(FIRST_BOUNDARY_FILE, { exact: true }),
  ).toBeVisible();
  // Whole-value regexes, not substrings: the closing dialog is still in the
  // DOM for its exit animation, and a substring match resolves to it too.
  await expect(page.getByText(SUMMARY_AREAS)).toBeVisible();
  await expect(page.getByText(SUMMARY_SHAPES)).toBeVisible();

  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Create Application" })
    .click();
  await waitForSideSheetClose(page);

  await page.getByLabel("Search applications").fill(fieldIdentifier);
  await expect(page.locator("table tbody tr[role='button']")).toHaveCount(1, {
    timeout: COLD_COMPILE_TIMEOUT_MS,
  });
  const applicationRow = page.locator("table tbody tr[role='button']").first();
  await applicationRow.click();
  await waitForSideSheet(page);
  // The saved panel prints the file name twice: once as the reference summary's
  // Source, once as the retained gis_boundary document in the evidence list.
  // Take the summary (first in DOM order) so the assertion stays unambiguous.
  await expect(
    page.getByText(FIRST_BOUNDARY_FILE, { exact: true }).first(),
  ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
  await expect(page.getByText(SUMMARY_AREAS)).toBeVisible();

  await page.getByRole("button", { name: "Edit Application" }).click();
  await page.getByRole("button", { name: "Replace" }).click();
  await page.getByRole("radio", { name: /Insert manually/ }).click();
  await page
    .locator("#gis-reference-text")
    .fill(JSON.stringify(PASTE_BOUNDARY));
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.getByText("Pasted GeoJSON")).toBeVisible({
    timeout: COLD_COMPILE_TIMEOUT_MS,
  });
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Update Application" })
    .click();
  await waitForSideSheetClose(page);

  await applicationRow.click();
  await waitForSideSheet(page);
  await expect(page.getByText("Pasted GeoJSON")).toBeVisible({
    timeout: COLD_COMPILE_TIMEOUT_MS,
  });
  await page.getByRole("button", { name: "Edit Application" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Update Application" })
    .click();
  await waitForSideSheetClose(page);

  await applicationRow.click();
  await waitForSideSheet(page);
  await expect(page.getByText("No GIS reference")).toBeVisible({
    timeout: COLD_COMPILE_TIMEOUT_MS,
  });
  await expect(page.getByText("Choose Edit to add the field boundary.")).toBeVisible();
});
