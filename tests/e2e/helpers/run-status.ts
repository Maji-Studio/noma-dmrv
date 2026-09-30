import type { Locator, Page } from "@playwright/test";

/**
 * Pick a production run status in the segmented control. The radios are
 * visually hidden, so the click goes to the segment's label.
 */
export async function chooseRunStatus(scope: Page | Locator, status: string) {
  await scope
    .locator(`label:has(input[type="radio"][name="status"][value="${status}"])`)
    .click();
}
