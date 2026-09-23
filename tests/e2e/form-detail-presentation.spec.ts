import { test, expect, waitForSideSheet } from "./fixtures";

for (const width of [1440, 390]) {
  test(`form detail stays in the heading and preserves edits at ${width}px`, async ({ adminPage: page, seededData }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: /New Production Run/i }).click();
    await waitForSideSheet(page);
    const dialog = page.getByRole("dialog");
    const simple = dialog.getByRole("radio", { name: "Simple", exact: true });
    const detailed = dialog.getByRole("radio", { name: "Detailed", exact: true });
    await expect(simple).toBeChecked();
    const title = dialog.getByRole("heading", { name: /Create Production Run/i });
    const titleBox = await title.boundingBox();
    // The visible label carries the hit target; the native radio is sr-only.
    const controlBox = await dialog.locator("[data-presentation-control]").boundingBox();
    expect(titleBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.y).toBeLessThan(titleBox!.y + titleBox!.height);
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(controlBox!.x);
    const firstField = dialog.locator('input[name="startDate"]');
    const before = await firstField.boundingBox();
    await detailed.locator("..").click();
    await expect(firstField).toBeVisible();
    expect((await firstField.boundingBox())!.y).toBe(before!.y);
    await simple.locator("..").click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Discard unsaved changes?", { exact: true })).toHaveCount(0);
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: /New Production Run/i }).click();
    await waitForSideSheet(page);
    await expect(simple).toBeChecked();
    const electricity = dialog.locator('input[name="electricityKwh"]');
    await electricity.fill("123");
    await detailed.locator("..").click();
    await simple.locator("..").click();
    await expect(electricity).toHaveValue("123");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Discard unsaved changes?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  });
}
