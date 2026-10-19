import { expect, test } from "./fixtures/auth-fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import { creditBatchRow } from "./fixtures/page-helpers";

test.describe("credit-batch row scanability", () => {
  test("prioritises feedstock and readiness without facility or registry labels", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const batch = await seedCreditBatch(
      seededData.facility.id,
      crypto.randomUUID().slice(0, 8).toUpperCase(),
      seededData.feedstockType.id,
    );

    await page.goto(`/credit-batches?facility=${seededData.facility.id}&view=list`);

    const row = creditBatchRow(page, batch.code);
    await expect(row).toHaveCount(1);
    await expect(row.getByText(seededData.feedstockType.name)).toBeVisible();
    // The timeline's state names: an unsubmitted batch is Open or Ready.
    await expect(row.getByText(/^(Open|Ready)$/)).toBeVisible();
    await expect(row.getByText(seededData.facility.name)).toHaveCount(0);
    await expect(row.getByText("Isometric", { exact: true })).toHaveCount(0);
  });
});
