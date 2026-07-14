/**
 * Production Run + Sample UI CRUD Tests
 *
 * Tests creating production runs and samples through the browser UI.
 * Uses seeded prerequisite data (facility, reactor, feedstock) from fixtures.
 *
 * Chain: Facility → Reactor → Production Run; samples anchor on a
 * credit batch directly (issue #309).
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import {
  selectEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

test.describe("Production Run + Sample UI CRUD", () => {
  async function createProductionRun(page: Page, seededData: SeededChainData) {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await expect(
      page.getByRole("button", { name: "New Production Run" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    await page.selectOption('select[name="status"]', "draft");

    await selectEntity(
      page,
      "Reactor",
      seededData.reactor.id,
      seededData.reactor.identifier
    );

    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="startDate"]', today);

    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name
    );

    await page.fill('input[name="feedstockWetMassKg"]', "50");
    await page.fill('input[name="feedstockMoisturePercent"]', "15");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Production Run")').click();
    await waitForSideSheetClose(page);
  }

  test("create production run via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    await createProductionRun(page, seededData);
    // The production run should show up - verify the page has at least one row
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("energy fields use example ('e.g.') placeholders, not bare numbers", async ({
    adminPage: page,
    seededData,
  }) => {
    // Bare-number placeholders ("50") read as filled values against the
    // "a blank field reads as missing, not zero" helper (QA C2); every energy
    // input must show an example instead so an empty CERT-critical field is
    // never mistaken for entered.
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    const expected: Record<string, string> = {
      dieselOperationLiters: "e.g. 50",
      dieselGensetLiters: "e.g. 25",
      preprocessingFuelLiters: "e.g. 10",
      electricityKwh: "e.g. 100",
    };
    for (const [name, placeholder] of Object.entries(expected)) {
      await expect(dialog.locator(`input[name="${name}"]`)).toHaveAttribute(
        "placeholder",
        placeholder,
      );
    }
  });

  test("create sample via UI form", async ({ adminPage: page, seededData }) => {
    // Samples anchor on a credit batch, not a production run (issue #309).
    const batch = await seedCreditBatch(
      seededData.facility.id,
      crypto.randomUUID().slice(0, 8),
      seededData.feedstockType.id,
    );

    // Navigate to samples
    await page.goto(`/samples?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    // Click "New Sample"
    await page.click('button:has-text("New Sample")');
    await waitForSideSheet(page);

    const sampleDialog = page.locator('[role="dialog"]');
    await selectEntity(page, "Credit Batch", batch.id, batch.code);

    // Fill some carbon analysis data
    await page.fill('input[name="totalCarbonPercent"]', "75");
    await page.fill('input[name="organicCarbonPercent"]', "70");

    // Submit
    const submitBtn = sampleDialog.locator('button[type="submit"]');
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    await waitForSideSheetClose(page);

    // Verify sample appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });
});

// Shared helpers for the time-window specs below (#259 overlap guard and
// #413 end-time clear both drive the run form through the same flows).
const overlapText = /overlaps run|unfinished run/i;

async function openRunForm(
  page: Page,
  seededData: SeededChainData,
  window: {
    startDate: string;
    startTime: string;
    endDate?: string;
    endTime?: string;
    status?: string;
  },
) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await page.getByRole("button", { name: "New Production Run" }).click();
  await waitForSideSheet(page);
  await page.selectOption('select[name="status"]', window.status ?? "running");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  await page.fill('input[name="startDate"]', window.startDate);
  await page.fill('input[name="startTime"]', window.startTime);
  if (window.endDate) await page.fill('input[name="endDate"]', window.endDate);
  if (window.endTime) await page.fill('input[name="endTime"]', window.endTime);
}

async function submitCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create Production Run")')
    .click();
}

async function editFirstRow(page: Page) {
  // Edit via the row overflow menu (openEdit — it does NOT set the deep-link
  // focus that would re-open a view sheet after save, so the sheet closes
  // cleanly). A post-save list refetch can re-render the row and detach the
  // menu's "Edit" item mid-click, so retry the open→Edit sequence instead of
  // waiting for network idle (CI dev servers may never settle within budget).
  await expect(async () => {
    await page
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: /Actions for/ })
      .click({ timeout: 5000 });
    await page.getByRole("menuitem", { name: "Edit" }).click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await waitForSideSheet(page);
  await expect(
    page.locator('[role="dialog"] input[name="startTime"]'),
  ).toBeVisible();
}

async function saveEdit(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Save Changes")')
    .click();
}

test.describe("Production Run reactor time-window overlap (#259)", () => {
  test("rejects a duplicate start on the same reactor", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2027-01-05",
      startTime: "08:00",
      endDate: "2027-01-05",
      endTime: "12:00",
      status: "complete",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await openRunForm(page, seededData, {
      startDate: "2027-01-05",
      startTime: "08:00",
      endDate: "2027-01-05",
      endTime: "10:00",
      status: "complete",
    });
    await submitCreate(page);

    await expect(
      page.locator('[role="dialog"]').getByText(overlapText),
    ).toBeVisible({ timeout: 10000 });
  });

  test("rejects an overlapping window on the same reactor", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2027-02-05",
      startTime: "08:00",
      endDate: "2027-02-05",
      endTime: "12:00",
      status: "complete",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    // 10:00–11:00 sits inside the first run's 08:00–12:00 window.
    await openRunForm(page, seededData, {
      startDate: "2027-02-05",
      startTime: "10:00",
      endDate: "2027-02-05",
      endTime: "11:00",
      status: "complete",
    });
    await submitCreate(page);

    await expect(
      page.locator('[role="dialog"]').getByText(overlapText),
    ).toBeVisible({ timeout: 10000 });
  });

  test("rejects a run starting after an unfinished (open) run", async ({
    adminPage: page,
    seededData,
  }) => {
    // Open run (no end time) — occupies [08:00, ∞) on the reactor.
    await openRunForm(page, seededData, {
      startDate: "2027-03-05",
      startTime: "08:00",
      status: "running",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    // A later run cannot start until the open run is closed.
    await openRunForm(page, seededData, {
      startDate: "2027-03-05",
      startTime: "13:00",
      endDate: "2027-03-05",
      endTime: "15:00",
      status: "complete",
    });
    await submitCreate(page);

    await expect(
      page.locator('[role="dialog"]').getByText(overlapText),
    ).toBeVisible({ timeout: 10000 });
  });

  test("accepts an overnight run (end date is the next day)", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2027-04-05",
      startTime: "22:00",
      endDate: "2027-04-06",
      endTime: "02:00",
      status: "complete",
    });
    await submitCreate(page);
    // A clean save closes the side sheet.
    await waitForSideSheetClose(page);
  });

  test("edit into a conflict is rejected; a non-time edit still saves", async ({
    adminPage: page,
    seededData,
  }) => {
    // Two non-overlapping runs on one reactor, with a gap between them.
    await openRunForm(page, seededData, {
      startDate: "2027-05-05",
      startTime: "08:00",
      endDate: "2027-05-05",
      endTime: "10:00",
      status: "complete",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await openRunForm(page, seededData, {
      startDate: "2027-05-05",
      startTime: "14:00",
      endDate: "2027-05-05",
      endTime: "16:00",
      status: "complete",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    // Edit whichever run is row 1 and stretch its window to 08:30–15:30, which
    // overlaps the OTHER run regardless of which one this is.
    await editFirstRow(page);
    await page.fill('input[name="startTime"]', "08:30");
    await page.fill('input[name="endTime"]', "15:30");
    await expect(page.locator('[role="dialog"] input[name="startTime"]')).toHaveValue("08:30");
    await saveEdit(page);
    await expect(
      page.locator('[role="dialog"]').getByText(overlapText),
    ).toBeVisible({ timeout: 10000 });

    // Move it to a slot clear of both runs — the edit now saves.
    await page.fill('input[name="startTime"]', "18:00");
    await page.fill('input[name="endTime"]', "19:00");
    await saveEdit(page);
    await waitForSideSheetClose(page);

    // Re-open a run and change only a non-time field; the run's own unchanged
    // window must not trip the overlap guard (self-exclusion).
    await editFirstRow(page);
    await page.fill('input[name="feedstockMoisturePercent"]', "18");
    await saveEdit(page);
    await waitForSideSheetClose(page);
  });
});

test.describe("Production Run end-time clear (#413)", () => {
  test("explicit clear reopens the run; untouched end fields stay unchanged", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = page.locator('[role="dialog"]');

    // A finished run: 2027-06-05 08:00–12:00, marked complete.
    await openRunForm(page, seededData, {
      startDate: "2027-06-05",
      startTime: "08:00",
      endDate: "2027-06-05",
      endTime: "12:00",
      status: "complete",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    // No-op guard: edit only a non-time field. Blank-or-untouched end fields
    // must mean "unchanged", never "clear".
    await editFirstRow(page);
    await page.fill('input[name="feedstockMoisturePercent"]', "18");
    await saveEdit(page);
    await waitForSideSheetClose(page);

    // The saved end time survived the non-time edit.
    await page.reload();
    await editFirstRow(page);
    await expect(dialog.locator('input[name="endDate"]')).toHaveValue("2027-06-05");
    await expect(dialog.locator('input[name="endTime"]')).toHaveValue("12:00");

    // Explicitly clear the end time. Reopening a completed run also moves it
    // back to Running so the form remains internally consistent and saveable.
    await dialog.getByRole("button", { name: /clear end time/i }).click();
    await expect(dialog.locator('select[name="status"]')).toHaveValue("running");
    await expect(dialog.locator('input[name="endDate"]')).toHaveValue("");
    await expect(dialog.locator('input[name="endTime"]')).toHaveValue("");
    await saveEdit(page);
    await waitForSideSheetClose(page);

    // The clear persisted: the edit form now shows no end date/time.
    await page.reload();
    await editFirstRow(page);
    await expect(dialog.locator('input[name="endDate"]')).toHaveValue("");
    await expect(dialog.locator('input[name="endTime"]')).toHaveValue("");

    // Server-side proof the run is truly open again: an open run occupies
    // [start, ∞) on its reactor, so a later same-day run must now be rejected
    // by the overlap guard. (Had the end time survived as 12:00 — or been
    // mangled into some bogus date — this 14:00–15:00 window would save fine.)
    await openRunForm(page, seededData, {
      startDate: "2027-06-05",
      startTime: "14:00",
      endDate: "2027-06-05",
      endTime: "15:00",
      status: "complete",
    });
    await submitCreate(page);
    await expect(dialog.getByText(overlapText)).toBeVisible({ timeout: 10000 });
  });

  test("create form has no clear-end-time control", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('input[name="endTime"]')).toBeVisible();
    // The explicit clear affordance is an edit-mode concept (blank end fields
    // on create already mean "no end yet"); it must not leak into create.
    await expect(
      dialog.getByRole("button", { name: /clear end time/i }),
    ).toHaveCount(0);
  });
});
