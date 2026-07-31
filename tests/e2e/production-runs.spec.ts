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
    await selectEntity(
      page,
      "Biochar Storage",
      seededData.biocharStorageLocation.id,
      seededData.biocharStorageLocation.name,
    );
    await page.fill('input[name="biocharOutputKg"]', "10");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Production Run")').click();
    await waitForSideSheetClose(page);
    await expect(page.getByRole("status")).toHaveText(
      "Production run created.",
    );
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
    await expect(page.getByRole("status")).toHaveText(
      "Sample created.",
    );

    // Verify sample appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("opens production sample and incident forms as dialogs", async ({
    adminPage: page,
    seededData,
  }) => {
    await createProductionRun(page, seededData);
    await editFirstRow(page);

    const runSideSheet = page.locator('[role="dialog"]').first();

    await runSideSheet.getByRole("button", { name: "Add measurement" }).click();
    const sampleDialog = page.getByTestId("production-sample-dialog");
    await expect(sampleDialog).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(2);
    await expect(
      sampleDialog.getByRole("heading", { name: "Add in-process measurement" }),
    ).toBeVisible();
    await sampleDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(sampleDialog).toBeHidden();
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);

    await runSideSheet.getByRole("button", { name: "Add Incident" }).click();
    const incidentDialog = page.getByTestId("production-incident-dialog");
    await expect(incidentDialog).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(2);
    await expect(
      incidentDialog.getByRole("heading", {
        name: "Add Production Incident",
      }),
    ).toBeVisible();
    await incidentDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(incidentDialog).toBeHidden();
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await expect(runSideSheet).toBeVisible();
  });
});

// Shared helpers for the production-run lifecycle and time-window specs below.
const overlapText = /overlaps run|is unfinished/i;

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

test.describe("Production Run lifecycle (#254)", () => {
  test("shows immediate concise wet and dry mass-balance feedback", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
    await dialog.locator('input[name="feedstockWetMassKg"]').fill("1000");
    await dialog.locator('input[name="feedstockMoisturePercent"]').fill("20");
    await dialog.locator('input[name="biocharOutputKg"]').fill("20000");

    await expect(dialog.getByText("Wet output exceeds wet input.")).toBeVisible();

    await dialog.locator('input[name="biocharMoisturePercent"]').fill("1.5");
    await expect(dialog.getByText("Dry output exceeds dry input.")).toBeVisible();
    await expect(dialog.getByText("Wet output exceeds wet input.")).not.toBeVisible();

    await dialog.locator('input[name="biocharOutputKg"]').fill("500");
    await expect(dialog.getByText("Dry output exceeds dry input.")).not.toBeVisible();

    await dialog.locator('input[name="feedstockMoisturePercent"]').fill("50");
    await dialog.locator('input[name="biocharOutputKg"]').fill("600");
    await dialog.locator('input[name="biocharMoisturePercent"]').fill("0");
    await expect(dialog.getByText("Dry output exceeds dry input.")).toBeVisible();
    await expect(dialog.getByText("Wet output exceeds wet input.")).not.toBeVisible();
  });

  test("defers the complete-run feedstock requirement until submit", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    const feedstockRequirement = dialog.getByText(
      "A complete run needs a source bin, moisture %, and wet mass to compute consumed feedstock.",
    );

    await dialog.locator('select[name="status"]').selectOption("complete");
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
    await dialog.locator('input[name="feedstockWetMassKg"]').fill("1000");
    await dialog.locator('input[name="feedstockMoisturePercent"]').focus();

    await expect(feedstockRequirement).not.toBeVisible();

    await submitCreate(page);
    await expect(feedstockRequirement).toBeVisible();
  });

  test("offers only legal initial statuses", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    await expect(
      page.locator('[role="dialog"] select[name="status"] option'),
    ).toHaveText(["Draft", "Running", "Complete", "Cancelled"]);
  });

  test("requires a cancellation reason and saves the cancelled audit record", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2025-01-05",
      startTime: "08:00",
      status: "cancelled",
    });

    const dialog = page.locator('[role="dialog"]');
    const cancellationReason = dialog.locator(
      'textarea[name="cancellationReason"]',
    );
    await expect(cancellationReason).toBeVisible();

    await submitCreate(page);
    await expect(dialog.getByText("Enter a cancellation reason.")).toBeVisible();

    await cancellationReason.fill("Duplicate run entered by the operator");
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await page
      .getByLabel("Filter production runs by status")
      .selectOption("cancelled");
    const cancelledBadge = page
      .locator('tbody [data-status="cancelled"]')
      .first();
    await expect(cancelledBadge).toBeVisible();
    await expect(cancelledBadge).toHaveText("Cancelled");
    await expect(cancelledBadge).toHaveAttribute("data-status-state", "neutral");
    await expect(cancelledBadge).toHaveClass(/--st-off-bg/);
  });

  test("waits for the missing feedstock field before showing its error", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2025-02-04",
      startTime: "08:00",
      endDate: "2025-02-04",
      endTime: "12:00",
      status: "complete",
    });

    const dialog = page.locator('[role="dialog"]');
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
    await dialog.locator('input[name="biocharOutputKg"]').fill("10");

    const wetMass = dialog.locator('input[name="feedstockWetMassKg"]');
    const moisture = dialog.locator(
      'input[name="feedstockMoisturePercent"]',
    );
    await wetMass.fill("5000");
    await moisture.focus();

    await expect(dialog.locator("#feedstockWetMassKg-error")).toHaveCount(0);
    await expect(
      dialog.locator("#feedstockMoisturePercent-error"),
    ).toHaveCount(0);

    await dialog.locator('input[name="feedingRateKgHr"]').focus();
    await expect(
      dialog.getByText("Enter feedstock moisture."),
    ).toBeVisible();

    await moisture.fill("15");
    await expect(
      dialog.getByText("Enter feedstock moisture."),
    ).toBeHidden();
  });

  test("renders a failed run with the canonical error treatment", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2025-02-05",
      startTime: "08:00",
      status: "running",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await page
      .getByLabel("Filter production runs by status")
      .selectOption("running");
    await expect(page.locator('tbody [data-status="running"]').first()).toBeVisible();
    await editFirstRow(page);

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[name="endDate"]').fill("2025-02-05");
    await dialog.locator('input[name="endTime"]').fill("12:00");
    // A failed run needs a source bin, moisture %, and wet mass to compute
    // consumed feedstock (same guard as a complete run) — the lifecycle
    // schema rejects the status change without them.
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
    await dialog.locator('input[name="feedstockWetMassKg"]').fill("50");
    await dialog.locator('input[name="feedstockMoisturePercent"]').fill("15");
    await dialog.locator('select[name="status"]').selectOption("failed");
    await saveEdit(page);
    await waitForSideSheetClose(page);

    await page
      .getByLabel("Filter production runs by status")
      .selectOption("failed");
    const failedBadge = page.locator('tbody [data-status="failed"]').first();
    await expect(failedBadge).toBeVisible();
    await expect(failedBadge).toHaveText("Failed");
    await expect(failedBadge).toHaveAttribute("data-status-state", "error");
    await expect(failedBadge).toHaveClass(/--st-bad-bg/);
  });
});

test.describe("Production Run reactor time-window overlap (#259)", () => {
  test("rejects a duplicate start on the same reactor", async ({
    adminPage: page,
    seededData,
  }) => {
    await openRunForm(page, seededData, {
      startDate: "2025-01-05",
      startTime: "08:00",
      endDate: "2025-01-05",
      endTime: "12:00",
      status: "draft",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await openRunForm(page, seededData, {
      startDate: "2025-01-05",
      startTime: "08:00",
      endDate: "2025-01-05",
      endTime: "10:00",
      status: "draft",
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
      startDate: "2025-02-05",
      startTime: "08:00",
      endDate: "2025-02-05",
      endTime: "12:00",
      status: "draft",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    // 10:00–11:00 sits inside the first run's 08:00–12:00 window.
    await openRunForm(page, seededData, {
      startDate: "2025-02-05",
      startTime: "10:00",
      endDate: "2025-02-05",
      endTime: "11:00",
      status: "draft",
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
      startDate: "2025-03-05",
      startTime: "08:00",
      status: "running",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    // A later run cannot start until the open run is closed.
    await openRunForm(page, seededData, {
      startDate: "2025-03-05",
      startTime: "13:00",
      endDate: "2025-03-05",
      endTime: "15:00",
      status: "draft",
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
      startDate: "2025-04-05",
      startTime: "22:00",
      endDate: "2025-04-06",
      endTime: "02:00",
      status: "draft",
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
      startDate: "2025-05-05",
      startTime: "08:00",
      endDate: "2025-05-05",
      endTime: "10:00",
      status: "draft",
    });
    await submitCreate(page);
    await waitForSideSheetClose(page);

    await openRunForm(page, seededData, {
      startDate: "2025-05-05",
      startTime: "14:00",
      endDate: "2025-05-05",
      endTime: "16:00",
      status: "draft",
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

test.describe("Production Run end-time editing", () => {
  test("untouched end fields stay unchanged and direct edits persist", async ({
    adminPage: page,
    seededData,
  }) => {
    const dialog = page.locator('[role="dialog"]');

    // Create the run open, then finish it through the legal Running → Complete
    // transition.
    await openRunForm(page, seededData, {
      startDate: "2025-06-05",
      startTime: "08:00",
      status: "running",
    });
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
    await page.fill('input[name="feedstockWetMassKg"]', "50");
    await page.fill('input[name="feedstockMoisturePercent"]', "15");
    await selectEntity(
      page,
      "Biochar Storage",
      seededData.biocharStorageLocation.id,
      seededData.biocharStorageLocation.name,
    );
    await page.fill('input[name="biocharOutputKg"]', "10");
    await submitCreate(page);
    await waitForSideSheetClose(page);
    await editFirstRow(page);
    await page.fill('input[name="endDate"]', "2025-06-05");
    await page.fill('input[name="endTime"]', "12:00");
    await page.selectOption('select[name="status"]', "complete");
    await saveEdit(page);
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
    await expect(dialog.locator('input[name="endDate"]')).toHaveValue("2025-06-05");
    await expect(dialog.locator('input[name="endTime"]')).toHaveValue("12:00");
    await expect(
      dialog.getByRole("button", { name: /clear end time/i }),
    ).toHaveCount(0);

    // A correction is made directly in the end-time field without changing
    // the run's completed lifecycle state.
    await dialog.locator('input[name="endTime"]').fill("13:00");
    await saveEdit(page);
    await waitForSideSheetClose(page);

    // The corrected time persisted and the run remains Complete.
    await page.reload();
    await editFirstRow(page);
    await expect(dialog.locator('input[name="endDate"]')).toHaveValue("2025-06-05");
    await expect(dialog.locator('input[name="endTime"]')).toHaveValue("13:00");
    await expect(dialog.locator('select[name="status"]')).toHaveValue("complete");
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
    // Reopening is not exposed as an incidental end-field control.
    await expect(
      dialog.getByRole("button", { name: /clear end time/i }),
    ).toHaveCount(0);
  });
});
