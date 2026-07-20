import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { test, expect } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { waitForSideSheet } from "./fixtures/page-helpers";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { creditBatches, orders, productionProcesses, samples } from "@/db/schema";

const SAME_YEAR_START = "2026-06-01";
const SAME_YEAR_END = "2026-06-30";
const CROSS_YEAR_START = "2026-12-15";
const CROSS_YEAR_END = "2027-01-10";
const ANALYSIS_DATE = "2026-06-13";

test("read surfaces use canonical dates while native inputs keep ISO values", async ({
  adminPage: page,
  seededData,
}) => {
  const { db, pool } = createDbConnection();
  const tag = randomUUID().slice(0, 8);
  const processId = randomUUID();
  const sameYearBatchId = randomUUID();
  const crossYearBatchId = randomUUID();
  const orderId = randomUUID();
  const sampleId = randomUUID();
  const sameYearCode = `E2E-DATE-SAME-${tag}`;
  const crossYearCode = `E2E-DATE-CROSS-${tag}`;
  const orderCode = `E2E-DATE-ORDER-${tag}`;
  const sampleCode = `E2E-DATE-SAMPLE-${tag}`;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(productionProcesses).values({
        id: processId,
        organizationId: DEC_ORG_ID,
        facilityId: seededData.facility.id,
        feedstockTypeId: seededData.feedstockType.id,
      });
      await tx.insert(creditBatches).values([
        {
          id: sameYearBatchId,
          organizationId: DEC_ORG_ID,
          code: sameYearCode,
          facilityId: seededData.facility.id,
          feedstockTypeId: seededData.feedstockType.id,
          productionProcessId: processId,
          startDate: SAME_YEAR_START,
          endDate: SAME_YEAR_END,
        },
        {
          id: crossYearBatchId,
          organizationId: DEC_ORG_ID,
          code: crossYearCode,
          facilityId: seededData.facility.id,
          feedstockTypeId: seededData.feedstockType.id,
          productionProcessId: processId,
          startDate: CROSS_YEAR_START,
          endDate: CROSS_YEAR_END,
        },
      ]);
      await tx.insert(orders).values({
        id: orderId,
        organizationId: DEC_ORG_ID,
        code: orderCode,
        facilityId: seededData.facility.id,
        orderDate: new Date(2026, 5, 13, 12),
        customerId: seededData.customer.id,
        customerLocationId: seededData.customerLocation.id,
        biocharProductId: seededData.biocharProduct.id,
        quantityKg: 100,
        packaging: "loose",
      });
      await tx.insert(samples).values({
        id: sampleId,
        organizationId: DEC_ORG_ID,
        sampleCode,
        creditBatchId: sameYearBatchId,
        samplingTime: new Date(2026, 5, 13, 12),
        analysisDate: ANALYSIS_DATE,
        totalCarbonPercent: 80,
        organicCarbonPercent: 78,
      });
    });

    await page.goto(`/orders?facility=${seededData.facility.id}`);
    const orderRow = page.locator("tbody tr").filter({ hasText: orderCode });
    await expect(orderRow).toContainText("Jun 13, 2026");

    await page.goto(`/credit-batches?facility=${seededData.facility.id}`);
    const sameYearCard = page.locator("article").filter({ hasText: sameYearCode });
    const crossYearCard = page.locator("article").filter({ hasText: crossYearCode });
    await expect(sameYearCard).toContainText("Jun 1 – Jun 30, 2026");
    await expect(crossYearCard).toContainText(
      "Dec 15, 2026 – Jan 10, 2027",
    );

    await sameYearCard
      .getByRole("button", { name: `Actions for credit batch ${sameYearCode}` })
      .click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await waitForSideSheet(page);
    await expect(page.locator('input[name="startDate"]')).toHaveValue(SAME_YEAR_START);
    await expect(page.locator('input[name="endDate"]')).toHaveValue(SAME_YEAR_END);

    await page.goto(`/samples?facility=${seededData.facility.id}`);
    await page.locator("tbody tr").filter({ hasText: sampleCode }).click();
    await waitForSideSheet(page);
    await expect(page.getByRole("dialog")).toContainText("Jun 13, 2026");

    await page.goto(`/dashboard?facility=${seededData.facility.id}`);
    const updatedLine = page.getByText(/Live operations · updated/);
    await expect(updatedLine).toHaveText(
      /^Live operations · updated [A-Z][a-z]{2} \d{1,2}, 20\d{2}, (?:[01]\d|2[0-3]):[0-5]\d$/,
    );
    await expect(updatedLine).not.toContainText(/\b(?:AM|PM)\b/);
  } finally {
    await db.delete(samples).where(inArray(samples.id, [sampleId]));
    await db.delete(orders).where(inArray(orders.id, [orderId]));
    await db
      .delete(creditBatches)
      .where(inArray(creditBatches.id, [sameYearBatchId, crossYearBatchId]));
    await db.delete(productionProcesses).where(inArray(productionProcesses.id, [processId]));
    await pool.end();
  }
});
