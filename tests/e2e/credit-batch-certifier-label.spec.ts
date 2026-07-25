import { expect, test } from "./fixtures/auth-fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

test.describe("credit-batch card scanability", () => {
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

    await page.goto(`/credit-batches?facility=${seededData.facility.id}`);

    const card = page.locator("article").filter({ hasText: batch.code });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(seededData.feedstockType.name)).toBeVisible();
    await expect(card.getByText(/Batch data ready|issues? open/)).toBeVisible();
    await expect(card.getByText(seededData.facility.name)).toHaveCount(0);
    await expect(card.getByText("Isometric", { exact: true })).toHaveCount(0);
  });
});
