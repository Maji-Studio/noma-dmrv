import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";

const DUPLICATE_REQUEST_SETTLE_MS = 1_000;

function collectDetailActionRequests(page: Page, entityId: string) {
  const requests: Request[] = [];
  const onRequest = (request: Request) => {
    if (
      request.method() === "POST" &&
      request.postData()?.includes(entityId)
    ) {
      requests.push(request);
    }
  };

  page.on("request", onRequest);

  return {
    requests,
    reset: () => requests.splice(0, requests.length),
    stop: () => page.off("request", onRequest),
  };
}

test("supplier detail is hydrated on client navigation and hard reload", async ({
  adminPage,
  seededData,
}, testInfo) => {
  const observed = collectDetailActionRequests(
    adminPage,
    seededData.supplier.id,
  );

  await adminPage.goto("/suppliers");
  await adminPage
    .getByRole("link", { name: seededData.supplier.code, exact: true })
    .click();

  await expect(adminPage).toHaveURL(
    new RegExp(`/suppliers/${seededData.supplier.id}(?:[?#]|$)`),
  );
  await expect(
    adminPage.getByRole("heading", {
      name: seededData.supplier.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: /^Locations \(\d+\)$/ }),
  ).toBeVisible();
  await adminPage.waitForTimeout(DUPLICATE_REQUEST_SETTLE_MS);
  expect(observed.requests).toHaveLength(0);

  await adminPage.screenshot({
    path: testInfo.outputPath("supplier-client-navigation.png"),
    fullPage: true,
  });

  observed.reset();
  await adminPage.reload();
  await expect(
    adminPage.getByRole("heading", {
      name: seededData.supplier.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: /^Locations \(\d+\)$/ }),
  ).toBeVisible();
  await adminPage.waitForTimeout(DUPLICATE_REQUEST_SETTLE_MS);
  expect(observed.requests).toHaveLength(0);

  await adminPage.screenshot({
    path: testInfo.outputPath("supplier-hard-reload.png"),
    fullPage: true,
  });
  observed.stop();
});

test("customer detail is hydrated on client navigation and hard reload", async ({
  adminPage,
  seededData,
}, testInfo) => {
  const observed = collectDetailActionRequests(
    adminPage,
    seededData.customer.id,
  );

  await adminPage.goto("/customers");
  await adminPage
    .getByRole("link", { name: seededData.customer.code, exact: true })
    .click();

  await expect(adminPage).toHaveURL(
    new RegExp(`/customers/${seededData.customer.id}(?:[?#]|$)`),
  );
  await expect(
    adminPage.getByRole("heading", {
      name: seededData.customer.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: /^Locations \(\d+\)$/ }),
  ).toBeVisible();
  await adminPage.waitForTimeout(DUPLICATE_REQUEST_SETTLE_MS);
  expect(observed.requests).toHaveLength(0);

  await adminPage.screenshot({
    path: testInfo.outputPath("customer-client-navigation.png"),
    fullPage: true,
  });

  observed.reset();
  await adminPage.reload();
  await expect(
    adminPage.getByRole("heading", {
      name: seededData.customer.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: /^Locations \(\d+\)$/ }),
  ).toBeVisible();
  await adminPage.waitForTimeout(DUPLICATE_REQUEST_SETTLE_MS);
  expect(observed.requests).toHaveLength(0);

  await adminPage.screenshot({
    path: testInfo.outputPath("customer-hard-reload.png"),
    fullPage: true,
  });
  observed.stop();
});
