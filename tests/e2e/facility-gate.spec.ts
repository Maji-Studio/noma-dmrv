import { expect, test } from "./fixtures/auth-fixtures";

test("facility-scoped lists render one operator gate and no inactive controls", async ({
  adminPage,
}, testInfo) => {
  await adminPage.evaluate(() => window.localStorage.clear());

  await adminPage.goto("/applications");
  await expect(
    adminPage.getByRole("heading", { name: "Applications", exact: true }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: "Select a facility", exact: true }),
  ).toHaveCount(1);
  await expect(
    adminPage.getByRole("button", { name: "New Application", exact: true }),
  ).toHaveCount(0);
  await expect(adminPage.locator("table")).toHaveCount(0);
  await adminPage.screenshot({
    path: testInfo.outputPath("applications-select-facility.png"),
    fullPage: true,
  });

  await adminPage.goto("/certification/production-processes");
  await expect(
    adminPage.getByRole("heading", {
      name: "Production Processes",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: "Select a facility", exact: true }),
  ).toHaveCount(1);
  await expect(
    adminPage.getByRole("button", { name: "Unlock", exact: true }),
  ).toHaveCount(0);
  await expect(adminPage.getByText("Start new process", { exact: true })).toHaveCount(0);
  await expect(adminPage.locator("table")).toHaveCount(0);
  await adminPage.screenshot({
    path: testInfo.outputPath("production-processes-select-facility.png"),
    fullPage: true,
  });
});
