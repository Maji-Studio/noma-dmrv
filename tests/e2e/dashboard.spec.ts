/**
 * Dashboard + credit-batch detail (visual design plan, Phase 5).
 *
 * Dashboard: KPI strip with sparkline slots, the Action center (record flags +
 * evidence gaps + live signal merged), feedstock mix, custody-flow ribbon, and
 * the period toggle — all facility-scoped.
 * Credit batch detail: header KPI row, compact health strip, and read panels
 * with the edit form behind the "Edit details" toggle.
 */
import { test, expect } from "./fixtures/auth-fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

test.describe("Dashboard (Phase 5)", () => {
  test("renders headline, KPI strip, panels, and the period toggle", async ({
    adminPage,
    seededData,
  }) => {
    const page = adminPage;
    await page.goto(`/dashboard?facility=${seededData.facility.id}`);

    await expect(
      page.getByRole("heading", { name: seededData.facility.name }),
    ).toBeVisible();

    // 5-card KPI strip
    const kpis = page.getByTestId("dashboard-kpis");
    await expect(kpis).toBeVisible();
    await expect(kpis.getByText("Feedstock processed")).toBeVisible();
    await expect(kpis.getByText("Biochar produced")).toBeVisible();
    await expect(kpis.getByText("Pyrolysis yield")).toBeVisible();
    await expect(kpis.getByText("Applied to soil")).toBeVisible();
    await expect(kpis.getByText("CO₂e stored")).toBeVisible();

    // Panels (Action center merges record flags + evidence gaps + live signal)
    await expect(page.getByText("Action center")).toBeVisible();
    await expect(page.getByText("Feedstock mix")).toBeVisible();
    await expect(page.getByText("Pipeline")).toBeVisible();

    // Period toggle switches the active segment
    const ytd = page.getByRole("button", { name: "YTD" });
    await ytd.click();
    await expect(ytd).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "30D" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

test.describe("Credit batch detail (Phase 5)", () => {
  test("header KPI row, health strip, and read panels with edit toggle", async ({
    adminPage,
    seededData,
  }) => {
    const batch = await seedCreditBatch(
      seededData.facility.id,
      crypto.randomUUID().slice(0, 8),
      seededData.feedstockType.id,
    );
    const page = adminPage;
    await page.goto(`/credit-batches/${batch.id}`);

    // Detail header: code as title, status badge alongside
    await expect(page.getByRole("heading", { name: batch.code })).toBeVisible();

    // KPI row
    await expect(page.getByText("CO₂e stored")).toBeVisible();
    await expect(page.getByText("Credit weight")).toBeVisible();
    await expect(page.getByText("Buffer pool")).toBeVisible();

    // Compact health strip replaces the full panel
    await expect(page.getByTestId("batch-health-strip")).toBeVisible();

    // Read panels by default — the edit form (date inputs) is not mounted
    await expect(page.getByText("Registry & accounting")).toBeVisible();
    await expect(page.locator("#startDate")).toHaveCount(0);

    // Edit toggle mounts the form; cancel returns to the read panels
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.locator("#startDate")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#startDate")).toHaveCount(0);
  });
});
