import type { Locator, Page } from "@playwright/test";
import { isTerminalProductionRunStatus, type ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import { expect } from "../fixtures";

/**
 * Pick a production run status in the segmented control. The radios are
 * visually hidden, so the click goes to the segment's label.
 */
export async function chooseRunStatus(scope: Page | Locator, status: ProductionRunStatus) {
  await scope
    .locator(`label:has(input[type="radio"][name="status"][value="${status}"])`)
    .click();
  await expectRunRequiredMarkers(scope, status);
}

/** Required markers follow the same terminal-state rules as submission. */
export async function expectRunRequiredMarkers(scope: Page | Locator, status: ProductionRunStatus) {
  const terminal = isTerminalProductionRunStatus(status);
  for (const field of ["endDate", "endTime", "feedstockMoisturePercent"]) {
    const label = scope.locator(`label[for="${field}"]`);
    if (terminal) await expect(label).toContainText("Required");
    else await expect(label).not.toContainText("Required");
  }
}
