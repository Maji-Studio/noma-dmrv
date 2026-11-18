/**
 * The component file (#1519): the From records amount of a component whose
 * proof setting is one file per credit batch holds that file on its records
 * row. The operator opens the line on the credit batch Emissions page, sees
 * File missing, adds a file and File missing is gone.
 */
import * as crypto from "crypto";
import { expect, test } from "./fixtures";
import { LINE_FILE_COMPONENT_NAME, seedLineFileComponent } from "./fixtures/emission-line-file-seed";
import { waitForFacilityHydration } from "./fixtures/page-helpers";

const FILE_NAME = "e2e-meter-readings.pdf";
const PDF_BYTES = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";

test.describe("Component file", () => {
  test("a file on the From records row clears File missing", async ({ adminPage: page, seededData }) => {
    test.setTimeout(300_000);
    const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
    const seeded = await seedLineFileComponent(seededData, tag);
    try {
      await page.goto(`/credit-batches/${seeded.creditBatchId}?facility=${seededData.facility.id}&tab=emissions`);
      await waitForFacilityHydration(page, seededData.facility.name);
      const toggle = page.getByRole("button", { name: LINE_FILE_COMPONENT_NAME }).locator("visible=true").first();
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();

      const table = page.getByRole("table", { name: `Sources of ${LINE_FILE_COMPONENT_NAME}` }).locator("visible=true").first();
      await expect(table.getByText("File missing")).toBeVisible({ timeout: 30_000 });

      await table.getByRole("button", { name: `Add file on ${LINE_FILE_COMPONENT_NAME}` }).click();
      await table.locator(`#line-file-rtc_e2e_line_file_${tag}`).setInputFiles({
        name: FILE_NAME,
        mimeType: "application/pdf",
        buffer: Buffer.from(PDF_BYTES),
      });

      await expect(table.getByRole("link", { name: FILE_NAME })).toBeVisible({ timeout: 30_000 });
      await expect(table.getByText("File missing")).toBeHidden();
    } finally {
      await seeded.cleanup();
    }
  });
});
