import { expect, test } from "./fixtures";

test.describe("Certification page", () => {
  test("renders the not-linked state for a facility without mapping", async ({
    adminPage,
    seededData,
  }) => {
    await adminPage.goto(`/certification?facility=${seededData.facility.id}`);

    await expect(
      adminPage.getByRole("heading", { name: "Certification" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      adminPage.getByText("This facility is not linked to an Isometric project."),
    ).toBeVisible();
  });
});
