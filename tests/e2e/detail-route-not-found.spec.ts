import * as crypto from "crypto";
import { expect, test } from "./fixtures/auth-fixtures";

const ROUTES = [
  {
    label: "credit batch",
    path: "/credit-batches",
    heading: "Credit batch not found",
    backLabel: "Back to credit batches",
    screenshot: "credit-batch-not-found.png",
  },
  {
    label: "supplier",
    path: "/suppliers",
    heading: "Supplier not found",
    backLabel: "Back to suppliers",
    screenshot: "supplier-not-found.png",
  },
  {
    label: "customer",
    path: "/customers",
    heading: "Customer not found",
    backLabel: "Back to customers",
    screenshot: "customer-not-found.png",
  },
] as const;

for (const route of ROUTES) {
  test(`${route.label} detail returns the canonical 404 for malformed and absent IDs`, async ({
    adminPage,
  }, testInfo) => {
    for (const id of ["__missing__", crypto.randomUUID()]) {
      const response = await adminPage.goto(`${route.path}/${id}`);

      expect(response?.status()).toBe(404);
      await expect(
        adminPage.getByRole("heading", { name: route.heading, exact: true }),
      ).toBeVisible();
      const backLink = adminPage.getByRole("link", {
        name: route.backLabel,
        exact: true,
      });
      await expect(backLink).toHaveAttribute("href", route.path);
      await expect(adminPage.getByText("Something went wrong")).toHaveCount(0);

      if (id === "__missing__") {
        await adminPage.screenshot({
          path: testInfo.outputPath(route.screenshot),
          fullPage: true,
        });
        await backLink.click();
        await expect(adminPage).toHaveURL(
          new RegExp(`${route.path}(?:[/?#]|$)`),
        );
      }
    }
  });
}
