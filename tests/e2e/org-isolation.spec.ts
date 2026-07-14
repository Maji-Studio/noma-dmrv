import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import * as schema from "../../src/db/schema";
import { auth } from "../../src/lib/auth/better-auth";
import {
  createDirectAuthContext,
  expect,
  test as base,
  type TestUser,
} from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

const TEST_PASSWORD = "TestPassword123!";

interface OrgBFixture {
  page: Page;
  facility: { id: string; name: string };
  supplier: { id: string; name: string };
}

const test = base.extend<{ orgB: OrgBFixture }>({
  orgB: async ({ browser }, provide) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const ids = {
      organization: `e2e-org-b-${tag}`,
      user: `e2e-org-b-user-${tag}`,
      account: `e2e-org-b-account-${tag}`,
      member: `e2e-org-b-member-${tag}`,
      facility: crypto.randomUUID(),
      supplier: crypto.randomUUID(),
    };
    const facilityName = `Org B Facility ${tag}`;
    const supplierName = `Org B Supplier ${tag}`;
    const user: TestUser = {
      id: ids.user,
      email: `org-b-member-${tag}@e2e.local`,
      name: "Org B E2E Member",
      role: "user",
      password: TEST_PASSWORD,
      projectRole: "member",
    };
    const { db, pool } = createDbConnection();
    let context: Awaited<ReturnType<typeof createDirectAuthContext>> | null = null;

    try {
      const passwordHash = await (await auth.$context).password.hash(
        TEST_PASSWORD
      );
      await db.transaction(async (tx) => {
        await tx.insert(schema.organizations).values({
          id: ids.organization,
          name: `Org B ${tag}`,
          slug: `org-b-${tag}`,
        });
        await tx.insert(schema.users).values({
          id: ids.user,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: true,
        });
        await tx.insert(schema.accounts).values({
          id: ids.account,
          userId: ids.user,
          accountId: `org-b-${tag}`,
          providerId: "credential",
          password: passwordHash,
        });
        await tx.insert(schema.members).values({
          id: ids.member,
          organizationId: ids.organization,
          userId: ids.user,
          role: "member",
        });
        await tx.insert(schema.facilities).values({
          id: ids.facility,
          organizationId: ids.organization,
          code: `ORG-B-FAC-${tag}`,
          name: facilityName,
          country: "Tanzania",
          timezone: "Africa/Dar_es_Salaam",
        });
        await tx.insert(schema.suppliers).values({
          id: ids.supplier,
          organizationId: ids.organization,
          code: `ORG-B-SUP-${tag}`,
          name: supplierName,
        });
      });

      const baseURL =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
      context = await createDirectAuthContext(browser, user, baseURL);
      const page = await context.newPage();

      await provide({
        page,
        facility: { id: ids.facility, name: facilityName },
        supplier: { id: ids.supplier, name: supplierName },
      });
    } finally {
      await context?.close();
      await db.transaction(async (tx) => {
        await tx.delete(schema.sessions).where(eq(schema.sessions.userId, ids.user));
        await tx.delete(schema.suppliers).where(eq(schema.suppliers.id, ids.supplier));
        await tx.delete(schema.facilities).where(eq(schema.facilities.id, ids.facility));
        await tx.delete(schema.members).where(eq(schema.members.id, ids.member));
        await tx.delete(schema.accounts).where(eq(schema.accounts.id, ids.account));
        await tx.delete(schema.users).where(eq(schema.users.id, ids.user));
        await tx
          .delete(schema.organizations)
          .where(eq(schema.organizations.id, ids.organization));
      });
      await pool.end();
    }
  },
});

test("organization domain data is isolated across lists, record URLs, and pickers", async ({
  orgB,
  seededData,
}) => {
  const orgABatch = await seedCreditBatch(
    seededData.facility.id,
    `ISOLATION-${crypto.randomUUID().slice(0, 8)}`,
    seededData.feedstockType.id,
  );

  await orgB.page.goto("/suppliers");
  await expect(
    orgB.page.getByRole("button").filter({ hasText: orgB.supplier.name }),
  ).toBeVisible();
  await expect(
    orgB.page.getByText(seededData.supplier.name, { exact: true }),
  ).toHaveCount(0);

  const response = await orgB.page.goto(`/credit-batches/${orgABatch.id}`);
  expect(response?.status()).toBe(404);
  await expect(
    orgB.page.getByRole("heading", {
      name: "Credit batch not found",
      exact: true,
    }),
  ).toBeVisible();
  await expect(orgB.page.getByText(orgABatch.code, { exact: true })).toHaveCount(0);

  const supplierResponse = await orgB.page.goto(
    `/suppliers/${seededData.supplier.id}`,
  );
  expect(supplierResponse?.status()).toBe(404);
  await expect(
    orgB.page.getByRole("heading", { name: "Supplier not found", exact: true }),
  ).toBeVisible();
  await expect(
    orgB.page.getByText(seededData.supplier.name, { exact: true }),
  ).toHaveCount(0);

  const customerResponse = await orgB.page.goto(
    `/customers/${seededData.customer.id}`,
  );
  expect(customerResponse?.status()).toBe(404);
  await expect(
    orgB.page.getByRole("heading", { name: "Customer not found", exact: true }),
  ).toBeVisible();
  await expect(
    orgB.page.getByText(seededData.customer.name, { exact: true }),
  ).toHaveCount(0);

  await orgB.page.goto(`/feedstocks?facility=${orgB.facility.id}`);
  await orgB.page.getByRole("button", { name: "New Feedstock" }).click();
  const dialog = orgB.page.getByRole("dialog");
  const supplierTrigger = dialog
    .locator("label")
    .filter({ hasText: "Supplier" })
    .first()
    .locator("xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]")
    .getByTestId("entity-select-trigger");

  await supplierTrigger.click();
  const options = dialog.getByRole("listbox");
  await expect(options.getByRole("option", { name: new RegExp(orgB.supplier.name) })).toBeVisible();
  await expect(options.getByText(seededData.supplier.name, { exact: true })).toHaveCount(0);
});
