import { test, expect, selectEntity, waitForSideSheet } from "./fixtures";

/**
 * Explanations open from an (i): on hover with a mouse and on a press
 * everywhere else. The sheet has one view, no Simple or Detailed switch, and an
 * open panel never traps the field being edited.
 */
const SPLIT_FORMULA = "Dry = wet × (1 - moisture). 50 kg × (1 - 15%) = 42.5 kg.";

for (const width of [1440, 390]) {
  test(`the feedstock split explains itself behind an (i) at ${width}px`, async ({ adminPage: page, seededData }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: /New production run/i }).click();
    await waitForSideSheet(page);
    const dialog = page.getByRole("dialog").first();
    await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: "Detailed", exact: true })).toHaveCount(0);

    await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
    // Nothing explains an empty split, so no (i) and no unresolved bar yet.
    const info = dialog.getByRole("button", { name: "How feedstock composition is worked out" });
    await expect(info).toHaveCount(0);
    await dialog.locator('input[name="feedstockDraws.0.wetMassKg"]').fill("50");
    await dialog.locator('input[name="feedstockMoisturePercent"]').fill("15");

    // The formula sentence stays inline; the ledger waits behind the (i).
    await expect(dialog.getByText(SPLIT_FORMULA, { exact: true })).toBeVisible();
    const ledger = page.getByRole("table", { name: /^Feedstock composition/ });
    await expect(ledger).toHaveCount(0);
    await expect(info).toBeVisible();

    // A press opens the panel, at any width.
    await info.click();
    await expect(ledger).toBeVisible();
    const panel = page.getByRole("dialog", { name: "Feedstock composition", exact: true });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width < 500) expect(box!.width).toBeLessThanOrEqual(width - 32);

    // An outside press closes it and still reaches the field being edited.
    const moisture = dialog.locator('input[name="feedstockMoisturePercent"]');
    await moisture.fill("20");
    await expect(ledger).toHaveCount(0);
    await expect(moisture).toHaveValue("20");

    // Escape closes it too.
    await info.click();
    await expect(ledger).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ledger).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
}

test("a mouse hover opens the explanation on desktop", async ({ adminPage: page, seededData }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await page.getByRole("button", { name: /New production run/i }).click();
  await waitForSideSheet(page);
  const dialog = page.getByRole("dialog").first();
  await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
  await dialog.locator('input[name="feedstockDraws.0.wetMassKg"]').fill("50");
  await dialog.locator('input[name="feedstockMoisturePercent"]').fill("15");
  await dialog.getByRole("button", { name: "How feedstock composition is worked out" }).hover();
  await expect(page.getByRole("table", { name: /^Feedstock composition/ })).toBeVisible();
});
