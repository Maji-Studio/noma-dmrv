/**
 * Dialog focus-restore regression (a11y).
 *
 * Modal closes are React-state-driven — `Modal` returns null on close, so the
 * native <dialog> unmounts and the browser's built-in focus-restore (which only
 * fires for method="dialog" closes) never runs. `useDialog` must return focus to
 * the element that opened the modal. This guards the bug where the effect's
 * top-level `if (!dialog) return` short-circuited before the restore branch on
 * every state-driven close, stranding keyboard/screen-reader users at document
 * start.
 */
import { test, expect } from "./fixtures";

test.describe("Dialog focus restore", () => {
  test("returns focus to the trigger after a Modal closes", async ({
    adminPage,
  }) => {
    const page = adminPage;

    await page.goto("/facilities");
    await expect(page.getByText("Active Facilities")).toBeVisible({
      timeout: 15000,
    });

    // The trash button on a facility card opens a Modal-based
    // DeleteConfirmDialog. It is icon-only, so capture it by locator (Edit then
    // Delete — the last button in the card's action group).
    const firstCard = page.locator("article").first();
    await expect(firstCard).toBeVisible();
    const deleteTrigger = firstCard.getByRole("button").last();
    await deleteTrigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Esc fires the native cancel → onClose; this only closes the dialog, it
    // does NOT confirm the delete, so seeded data is untouched.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The fix under test: focus returns to the button that opened the dialog.
    await expect(deleteTrigger).toBeFocused();
  });
});
