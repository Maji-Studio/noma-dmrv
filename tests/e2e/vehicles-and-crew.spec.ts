/**
 * Vehicles and crew E2E
 *
 * One driver through the list page: create from the Drivers tab, open the view
 * sheet (and its `?driver=<id>` link), edit it, delete it from the row menu. Ends in deletion so the spec
 * leaves no rows behind (driver codes are generated and would escape the
 * E2E- teardown sweep).
 */
import { test, expect, waitForSideSheet, waitForSideSheetClose } from "./fixtures";
import { clickRowMenuItem } from "./fixtures/page-helpers";

test.describe("Vehicles and crew", () => {
  test("admin can create, edit and delete a driver", async ({ adminPage: page }) => {
    const name = `E2E Driver ${Date.now()}`;
    const editedName = `${name} Edited`;
    const row = (text: string) => page.locator("table tbody tr", { hasText: text });

    await page.goto("/vehicles-and-crew?tab=driver");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("tab", { name: /^Drivers/ })).toHaveAttribute("aria-selected", "true");

    // Create
    await page.getByRole("button", { name: "New driver" }).first().click();
    await waitForSideSheet(page);
    await page.getByLabel("Name").first().fill(name);
    await page.getByRole("dialog").getByRole("button", { name: /^Create driver$/ }).click();
    await waitForSideSheetClose(page);
    await expect(row(name)).toBeVisible({ timeout: 10_000 });

    // View, then edit from the sheet
    const href = await row(name).getByRole("link", { name }).getAttribute("href");
    expect(href).toMatch(/^\/vehicles-and-crew\?driver=/);
    await row(name).getByRole("link", { name }).click();
    await waitForSideSheet(page);
    await expect(page.getByRole("dialog")).toContainText(name);
    await page.keyboard.press("Escape");
    await waitForSideSheetClose(page);

    // The row's link opens the same sheet on the Drivers tab
    await page.goto(href!);
    await waitForSideSheet(page);
    await expect(page.getByRole("tab", { name: /^Drivers/, includeHidden: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog")).toContainText(name);
    await page.getByRole("dialog").getByRole("button", { name: "Edit driver" }).click();
    await page.getByLabel("Name").first().fill(editedName);
    await page.getByRole("dialog").getByRole("button", { name: /^Save changes$/ }).click();
    await waitForSideSheetClose(page);
    await expect(row(editedName)).toBeVisible({ timeout: 10_000 });

    // Delete from the row menu
    await clickRowMenuItem(page, row(editedName).getByRole("button", { name: `Actions for ${editedName}` }), "Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row(editedName)).toHaveCount(0, { timeout: 10_000 });
  });
});
