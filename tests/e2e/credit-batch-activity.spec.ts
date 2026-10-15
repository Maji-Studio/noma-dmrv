/**
 * Credit batch Activity: the side sheet summary and latest entries, the link
 * to the Traceability Activity segment, its filters, tombstones, and the empty
 * state that names when recording started.
 *
 * Events are seeded with an explicit credit batch link, so global teardown
 * sweeps them with the E2E batch (`credit_batch_id` in scope).
 */
import * as crypto from "crypto";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { test, expect, type SeededChainData } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

const MS_PER_MINUTE = 60_000;
const PREVIEW_LIMIT = 5;
/** ACTIVITY_LIST_PAGE_SIZE in src/config/activity.ts. */
const PAGE_SIZE = 25;
const OLDER_ENTRIES = 5;

type ActivityRow = typeof schema.activityEvents.$inferInsert;

async function seedBatchActivity(seededData: SeededChainData, creditBatchId: string, adminUserId: string) {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * MS_PER_MINUTE);
  const base = {
    organizationId: DEC_ORG_ID,
    facilityId: seededData.facility.id,
    creditBatchId,
    entityType: "credit_batch",
    entityId: creditBatchId,
  } satisfies Partial<ActivityRow>;
  const rows: ActivityRow[] = [
    { ...base, action: "created", source: "form", actorUserId: adminUserId, occurredAt: at(60) },
    { ...base, action: "updated", source: "system", changedFields: ["production_runs"], occurredAt: at(50) },
    { ...base, action: "status_changed", source: "rest", actorUserId: adminUserId, fromStatus: "draft", toStatus: "in_review", occurredAt: at(40) },
    {
      ...base, entityType: "feedstock", entityId: seededData.feedstock.id, action: "updated", source: "form",
      actorUserId: adminUserId, changedFields: ["massWetKg", "notes"], occurredAt: at(30),
    },
    {
      // A sample that no longer exists: its history stays as a tombstone.
      ...base, entityType: "lab_sample", entityId: crypto.randomUUID(), action: "deleted", source: "form",
      actorUserId: adminUserId, occurredAt: at(20),
    },
    { ...base, action: "updated", source: "form", actorUserId: adminUserId, changedFields: ["siteManagementNotes"], occurredAt: at(10) },
  ];
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.activityEvents).values(rows);
  } finally {
    await pool.end();
  }
  return rows.length;
}

test.describe("credit batch activity", () => {
  test("summarises activity in the side sheet and filters the Traceability Activity segment", async ({
    adminPage: page,
    seededData,
    testUsers,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `ACT-${runId}`, seededData.feedstockType.id);
    const total = await seedBatchActivity(seededData, batch.id, testUsers.admin.id);

    await page.goto(`/credit-batches?facility=${seededData.facility.id}&batch=${batch.id}`);
    const sheet = page.getByRole("dialog");
    const section = sheet.getByTestId("credit-batch-activity-section");
    await expect(section).toBeVisible();
    const summary = section.getByRole("definition");
    await expect(section.getByText("Last change")).toBeVisible();
    await expect(summary.filter({ hasText: testUsers.admin.name })).toHaveCount(1);
    await expect(section.locator("dt", { hasText: "Updated" })).toBeVisible();
    await expect(section.getByTestId("activity-entry")).toHaveCount(PREVIEW_LIMIT);

    const openAll = section.getByRole("link", { name: new RegExp(`Open all activity \\(${total} changes\\)`) });
    await openAll.click();

    await expect(page).toHaveURL(/\/traceability\?.*view=activity/);
    const view = page.getByTestId("credit-batch-activity-view");
    await expect(view).toBeVisible();
    const entries = view.getByTestId("activity-entry");
    await expect(entries).toHaveCount(total);
    // Actorless and API changes read as their source.
    await expect(view.getByText("System", { exact: true })).toBeVisible();
    await expect(view.getByText("via API")).toBeVisible();
    // Field names only, in human terms.
    await expect(view.getByText(/Changed: .*Notes/).first()).toBeVisible();

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

  test("loads older activity a page at a time and moves focus to the first new entry", async ({
    adminPage: page,
    seededData,
    testUsers,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `ACTP-${runId}`, seededData.feedstockType.id);
    const now = Date.now();
    const { db, pool } = createDbConnection();
    try {
      await db.insert(schema.activityEvents).values(Array.from({ length: PAGE_SIZE + OLDER_ENTRIES }, (_, index) => ({
        organizationId: DEC_ORG_ID, facilityId: seededData.facility.id, creditBatchId: batch.id,
        entityType: "credit_batch" as const, entityId: batch.id, action: "updated" as const, source: "form" as const,
        actorUserId: testUsers.admin.id, changedFields: ["siteManagementNotes"], occurredAt: new Date(now - index * MS_PER_MINUTE),
      })));
    } finally {
      await pool.end();
    }

    await page.goto(`/traceability?${new URLSearchParams({ facility: seededData.facility.id, batch: batch.id, view: "activity" })}`);
    const view = page.getByTestId("credit-batch-activity-view");
    const entries = view.getByTestId("activity-entry");
    await expect(entries).toHaveCount(PAGE_SIZE);
    await view.getByRole("button", { name: "Show older activity" }).focus();
    await page.keyboard.press("Enter");
    await expect(entries).toHaveCount(PAGE_SIZE + OLDER_ENTRIES);
    await expect(entries.nth(PAGE_SIZE).locator(":focus")).toHaveCount(1);
    await expect(view.getByRole("status")).toHaveText(`${OLDER_ENTRIES} changes loaded.`);
    await expect(view.getByText("Earlier changes are not listed.")).toBeVisible();
  });
});
