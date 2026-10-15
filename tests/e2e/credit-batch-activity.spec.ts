/**
 * Credit batch Activity: the side sheet summary and latest entries, the link
 * to the Traceability Activity segment, its filters, record deep links,
 * tombstones, paging, and the empty state that names when recording started.
 *
 * Events are seeded with an explicit credit batch link, so global teardown
 * sweeps them with the E2E batch (`credit_batch_id` in scope); the seeded
 * order carries an `E2E-` code.
 */
import * as crypto from "crypto";
import { ACTIVITY_LIST_PAGE_SIZE } from "@/config/activity";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect, type SeededChainData } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

const MS_PER_MINUTE = 60_000;
const PAGE_SIZE = ACTIVITY_LIST_PAGE_SIZE;
const OLDER_ENTRIES = 5;
const ORDER_QUANTITY_KG = 100;

type ActivityRow = typeof schema.activityEvents.$inferInsert;

async function seedOrder(seededData: SeededChainData, runId: string) {
  const { db, pool } = createDbConnection();
  try {
    const [order] = await db.insert(schema.orders).values({
      organizationId: DEC_ORG_ID, code: `E2E-OR-ACT-${runId}`, facilityId: seededData.facility.id,
      orderDate: new Date(), customerId: seededData.customer.id, customerLocationId: seededData.customerLocation.id,
      formulationId: seededData.formulation.id, quantityKg: ORDER_QUANTITY_KG, packaging: "loose",
    }).returning();
    return order;
  } finally {
    await pool.end();
  }
}

async function insertActivity(rows: ActivityRow[]) {
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.activityEvents).values(rows);
  } finally {
    await pool.end();
  }
}

/** Seven events, oldest first here; the test asserts the newest-first reading order. */
const SEEDED_EVENTS = 7;
async function seedBatchActivity(seededData: SeededChainData, creditBatchId: string, orderId: string, adminUserId: string) {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * MS_PER_MINUTE);
  const base = {
    organizationId: DEC_ORG_ID,
    facilityId: seededData.facility.id,
    creditBatchId,
    entityType: "credit_batch",
    entityId: creditBatchId,
  } satisfies Partial<ActivityRow>;
  await insertActivity([
    { ...base, action: "created", source: "form", actorUserId: adminUserId, occurredAt: at(70) },
    { ...base, action: "updated", source: "system", changedFields: ["production_runs"], occurredAt: at(60) },
    { ...base, action: "status_changed", source: "rest", actorUserId: adminUserId, fromStatus: "draft", toStatus: "in_review", occurredAt: at(50) },
    {
      ...base, entityType: "feedstock", entityId: seededData.feedstock.id, action: "updated", source: "form",
      actorUserId: adminUserId, changedFields: ["massWetKg", "notes"], occurredAt: at(40),
    },
    {
      // A sample that no longer exists: its history stays as a tombstone.
      ...base, entityType: "lab_sample", entityId: crypto.randomUUID(), action: "deleted", source: "form",
      actorUserId: adminUserId, occurredAt: at(30),
    },
    { ...base, entityType: "order", entityId: orderId, action: "updated", source: "form", actorUserId: adminUserId, changedFields: ["quantityKg"], occurredAt: at(20) },
    { ...base, action: "updated", source: "form", actorUserId: adminUserId, changedFields: ["removalTemplateId"], occurredAt: at(10) },
  ]);
}

test.describe("credit batch activity", () => {
  test("summarises activity in the side sheet, filters the Activity segment and opens a record", async ({
    adminPage: page,
    seededData,
    testUsers,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `ACT-${runId}`, seededData.feedstockType.id);
    const order = await seedOrder(seededData, runId);
    await seedBatchActivity(seededData, batch.id, order.id, testUsers.admin.id);
    const total = SEEDED_EVENTS;

    await page.goto(`/credit-batches?facility=${seededData.facility.id}&batch=${batch.id}`);
    const sheet = page.getByRole("dialog");
    const section = sheet.getByTestId("credit-batch-activity-section");
    await expect(section).toBeVisible();
    // Exact summary: last change and who, then changes per kind in reading order.
    const summary = section.locator("dl[aria-label='Activity summary']");
    await expect(summary.locator("dt")).toHaveText(["Last change", "Created", "Updated", "Status changed", "Deleted"]);
    await expect(summary.locator("dd")).toHaveText([
      new RegExp(`^[A-Z][a-z]{2} \\d{1,2}, \\d{4}, \\d{2}:\\d{2} by ${testUsers.admin.name}$`), "1", "4", "1", "1",
    ]);
    // The latest five, newest first.
    const latest = section.getByTestId("activity-entry");
    await expect(latest).toHaveCount(5);
    expect(await latest.evaluateAll(rows => rows.map(row => `${row.getAttribute("data-kind")}:${row.getAttribute("data-record-type")}`))).toEqual([
      "updated:credit_batch", "updated:order", "deleted:lab_sample", "updated:feedstock", "status_changed:credit_batch",
    ]);
    await expect(latest.first()).toContainText("Changed: Removal template");

    await section.getByRole("link", { name: new RegExp(`Open all activity \\(${total} changes\\)`) }).click();

    await expect(page).toHaveURL(/\/traceability\?.*view=activity/);
    const view = page.getByTestId("credit-batch-activity-view");
    await expect(view).toBeVisible();
    const entries = view.getByTestId("activity-entry");
    await expect(entries).toHaveCount(total);
    // Actorless and API changes read as their source.
    await expect(view.getByText("System", { exact: true })).toBeVisible();
    await expect(view.getByText("via API")).toBeVisible();
    // Field names only, in human terms.
    await expect(view.getByText("Changed: Wet mass (kg), Notes")).toBeVisible();

    await view.getByLabel("Kind").selectOption("deleted");
    await expect(entries).toHaveCount(1);
    await expect(entries.first().getByTestId("activity-tombstone")).toHaveText("Deleted record");
    await expect(entries.first().getByRole("link")).toHaveCount(0);

    await view.getByRole("button", { name: "Clear filters" }).click();
    await expect(entries).toHaveCount(total);
    await view.getByLabel("Record type").selectOption("feedstock");
    await expect(entries).toHaveCount(1);
    await expect(entries.first().getByRole("link")).toHaveAttribute(
      "href",
      `/feedstocks?facility=${seededData.facility.id}&feedstock=${seededData.feedstock.id}`,
    );

    await view.getByLabel("Kind").selectOption("deleted");
    await expect(view.getByText("No matching activity")).toBeVisible();

    // Follow a record's deep link: the order opens in its list's side sheet.
    await view.getByRole("button", { name: "Clear filters" }).click();
    await view.getByLabel("Record type").selectOption("order");
    await expect(entries).toHaveCount(1);
    await entries.first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/orders\\?.*order=${order.id}`));
    await expect(page.getByRole("dialog").getByText(order.code)).toBeVisible();
  });

  test("names the recording start for a batch with no activity", async ({ adminPage: page, seededData, cleanupTestData }) => {
    void cleanupTestData;
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `ACTE-${runId}`, seededData.feedstockType.id);

    await page.goto(`/traceability?${new URLSearchParams({ facility: seededData.facility.id, batch: batch.id, view: "activity" })}`);
    const view = page.getByTestId("credit-batch-activity-view");
    await expect(view.getByRole("heading", { name: "No activity recorded yet" })).toBeVisible();
    await expect(view.getByText(/Activity is recorded from [A-Z][a-z]{2} \d{1,2}, 2026\./)).toBeVisible();
    await expect(page.getByTestId("chain-view-segment").getByRole("button", { name: "Activity" })).toHaveAttribute("aria-pressed", "true");
  });

  test("loads older activity a page at a time, moves focus, and restarts at the first page on a filter change", async ({
    adminPage: page,
    seededData,
    testUsers,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `ACTP-${runId}`, seededData.feedstockType.id);
    const now = Date.now();
    const count = PAGE_SIZE + OLDER_ENTRIES;
    // The oldest event is the creation; every later one is an update.
    await insertActivity(Array.from({ length: count }, (_, index) => ({
      organizationId: DEC_ORG_ID, facilityId: seededData.facility.id, creditBatchId: batch.id,
      entityType: "credit_batch" as const, entityId: batch.id, action: index === count - 1 ? "created" as const : "updated" as const,
      source: "form" as const, actorUserId: testUsers.admin.id, changedFields: ["siteManagementNotes"],
      occurredAt: new Date(now - index * MS_PER_MINUTE),
    })));

    await page.goto(`/traceability?${new URLSearchParams({ facility: seededData.facility.id, batch: batch.id, view: "activity" })}`);
    const view = page.getByTestId("credit-batch-activity-view");
    const entries = view.getByTestId("activity-entry");
    const showOlder = view.getByRole("button", { name: "Show older activity" });
    await expect(entries).toHaveCount(PAGE_SIZE);
    await showOlder.focus();
    await page.keyboard.press("Enter");
    await expect(entries).toHaveCount(count);
    await expect(entries.nth(PAGE_SIZE).locator(":focus")).toHaveCount(1);
    await expect(view.getByRole("status")).toHaveText(`${OLDER_ENTRIES} changes loaded.`);
    await expect(view.getByText("Earlier changes are not listed.")).toBeVisible();

    // A filter is a new list: it starts again at its own first page.
    await view.getByLabel("Kind").selectOption("updated");
    await expect(entries).toHaveCount(PAGE_SIZE);
    await expect(showOlder).toBeVisible();
    await expect(view.locator("[data-kind='created']")).toHaveCount(0);
    await view.getByLabel("Kind").selectOption("created");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toHaveAttribute("data-kind", "created");
    await expect(showOlder).toHaveCount(0);
  });
});
