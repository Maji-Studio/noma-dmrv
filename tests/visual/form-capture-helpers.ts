/**
 * Page helpers for the form capture harness. Nothing here writes: helpers
 * only navigate and open sheets and dialogs.
 */
import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { waitForFacilityHydration } from "../e2e/fixtures/page-helpers";
import { findBin, type CaptureContext, type SeededBin } from "./form-capture-context";

const SETTLE_TIMEOUT_MS = 20_000;
/** Sheet transitions run 300 ms; debounced previews start shortly after. */
const SETTLE_PAUSE_MS = 400;
const OPEN_TIMEOUT_MS = 30_000;
const QUICK_ADD_OPTION_TIMEOUT_MS = 8_000;

/** Hides the Next.js dev overlay badge so it never lands in a capture. */
export async function hideDevOverlay(page: Page) {
  await page.context().addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  });
}

export async function gotoRoute(page: Page, ctx: CaptureContext, route: string) {
  const separator = route.includes("?") ? "&" : "?";
  await page.goto(`/${route}${separator}facility=${ctx.facility.id}`);
  await waitForFacilityHydration(page, ctx.facility.name);
  await settle(page, page.locator("main"));
}

/** Waits for skeletons, busy regions and pending previews to finish. */
export async function settle(page: Page, scope: Locator) {
  await expect
    .poll(
      async () =>
        scope
          .locator('[aria-busy="true"]:visible, .animate-pulse:visible')
          .count()
          .catch(() => 0),
      { timeout: SETTLE_TIMEOUT_MS },
    )
    .toBe(0)
    .catch(() => undefined);
  await expect(page.getByText(/^(Refreshing stock preview|Loading batch breakdown|Loading stock history|Loading…|Loading\.\.\.)/).filter({ visible: true }))
    .toHaveCount(0, { timeout: SETTLE_TIMEOUT_MS })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_PAUSE_MS);
}

export function lastSheet(page: Page): Locator {
  return page.locator('[data-overlay-layer="sheet"]').last();
}

export function lastDialog(page: Page): Locator {
  return page.locator('[data-overlay-layer="dialog"]').last();
}

export async function openSheetFromButton(page: Page, name: string | RegExp): Promise<Locator> {
  await page.getByRole("button", { name, exact: typeof name === "string" }).first().click();
  const sheet = lastSheet(page);
  await expect(sheet).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  return sheet;
}

export async function openDialogFromButton(scope: Page | Locator, page: Page, name: string | RegExp): Promise<Locator> {
  await scope.getByRole("button", { name, exact: typeof name === "string" }).first().click();
  const dialog = lastDialog(page);
  await expect(dialog).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  return dialog;
}

/** Opens a list row's read sheet by the row's visible code. */
export async function openRowSheet(page: Page, text: string): Promise<Locator> {
  // Code cells can be links to a detail page; a later plain cell opens the sheet.
  const row = page.locator("table tbody tr", { hasText: text }).first();
  const cells = row.locator("td");
  await ((await cells.count()) > 1 ? cells.nth(1) : row).click();
  const sheet = lastSheet(page);
  await expect(sheet).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  return sheet;
}

/** Switches an open read sheet to its edit form through the footer button. */
export async function openEdit(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole("button", { name: /^Edit\b/ }).last().click();
  await expect(sheet.getByRole("button", { name: "Back to view", exact: true })).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  return lastSheet(page);
}

/** Opens an "Actions for …" menu and picks an item. */
export async function menuItem(page: Page, menuLabel: string, item: string | RegExp) {
  await page.getByRole("button", { name: menuLabel, exact: true }).first().click();
  await page.getByRole("menuitem", { name: item, exact: typeof item === "string" }).first().click();
}

/** Opens a storage bin's read sheet from its tile on /storage-locations. */
export async function openBinSheet(page: Page, ctx: CaptureContext, binName: string): Promise<Locator> {
  await gotoRoute(page, ctx, "storage-locations");
  await page.getByRole("button", { name: binName, exact: true }).first().click();
  const sheet = lastSheet(page);
  await expect(sheet).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  await settle(page, sheet);
  return sheet;
}

/** Opens an EntitySelect's quick-add dialog through its "Add new …" option. */
export async function openQuickAdd(page: Page, scope: Locator, trigger: string): Promise<Locator | string> {
  const combobox = scope.getByRole("combobox", { name: trigger, exact: true }).first();
  if ((await combobox.count()) === 0) return `no "${trigger}" select on this form`;
  await combobox.click();
  const create = page.getByTestId("entity-select-create").last();
  const shown = await create.waitFor({ state: "visible", timeout: QUICK_ADD_OPTION_TIMEOUT_MS }).then(() => true, () => false);
  if (!shown) {
    await page.keyboard.press("Escape");
    return `"${trigger}" offers no quick-add option with the seeded data`;
  }
  await create.click();
  const dialog = lastDialog(page);
  await expect(dialog).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  return dialog;
}

/** Opens a bin's loss or count sheet from its read sheet. */
export async function binMovementSheet(
  page: Page,
  ctx: CaptureContext,
  type: SeededBin["type"],
  button: "Record loss" | "Reconcile stock",
): Promise<Locator> {
  const sheet = await openBinSheet(page, ctx, findBin(ctx, { type })!.name);
  await sheet.getByRole("button", { name: button, exact: true }).first().click();
  const movement = lastSheet(page);
  await expect(movement.getByRole("heading", { name: /^Reconcile / }).first()).toBeVisible();
  return movement;
}

/**
 * Runs `open` with every non-GET request aborted (server actions are POSTs;
 * reads go through GET /api/reads). Returns how many writes were attempted.
 */
export async function withWritesBlocked<T>(page: Page, open: () => Promise<T>): Promise<{ result: T; attempted: number }> {
  let attempted = 0;
  const block = async (route: Route) => {
    if (route.request().method() !== "GET") {
      attempted += 1;
      return route.abort();
    }
    return route.fallback();
  };
  await page.route("**/*", block);
  try {
    return { result: await open(), attempted };
  } finally {
    await page.unroute("**/*", block);
  }
}

/** Waits until React has hydrated the page's first form, heading or main region. */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const target = document.querySelector("form, main, h1");
    return Boolean(target && Object.keys(target).some((key) => key.startsWith("__react")));
  });
}
