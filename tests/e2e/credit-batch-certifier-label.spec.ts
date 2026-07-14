import * as crypto from "crypto";
import { expect, test } from "./fixtures/auth-fixtures";
import {
  SANDBOX_PROJECT_ID,
  seedCertifierMapping,
} from "./fixtures/certification-helpers";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

test.describe("credit-batch certifier label", () => {
  test("inherits the facility's Isometric mapping on the batch card", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(
      seededData.facility.id,
      tag,
      seededData.feedstockType.id,
    );
    const mapping = await seedCertifierMapping(seededData.facility.id, {
      // Use the real sandbox project for read-only health loaders when local
      // credentials exist; hermetic CI has no credentials and never calls out.
      externalProjectId:
        SANDBOX_PROJECT_ID ?? `prj_e2e_batch_label_${tag}`,
    });

    try {
      await page.goto(
        `/credit-batches?facility=${seededData.facility.id}`,
      );

      const card = page.locator("article").filter({ hasText: batch.code });
      await expect(card).toHaveCount(1);
      await expect(card.getByText("Isometric", { exact: true })).toBeVisible();
      await expect(card.getByText("No certifier", { exact: true })).toHaveCount(0);
    } finally {
      await mapping.cleanup();
    }
  });
});
