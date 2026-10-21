import type { Locator } from "@playwright/test";
import { test, expect, selectEntity, waitForSideSheet } from "./fixtures";

const DESKTOP_WIDTH = 1440;
const PHONE_WIDTH = 390;
const VIEWPORT_HEIGHT = 900;
/** Below this width the sheet is a phone layout and the panel keeps a gutter. */
const PHONE_MAX_WIDTH = 500;
/** Gutter the panel keeps to the viewport edge on a phone. */
const PANEL_GUTTER_PX = 16;
/** Entered feedstock figures; SPLIT_FORMULA below is worked from them. */
const WET_MASS_KG = "50";
const MOISTURE_PERCENT = "15";
const EDITED_MOISTURE_PERCENT = "20";
/** Offset of the first pointer move, so the pointer arrives over several moves. */
const POINTER_APPROACH_PX = { x: 60, y: 40 };
const POINTER_STEPS = 8;
const SETTLE_POLL_MS = 100;
const SETTLE_MAX_POLLS = 30;

/** The box of a control once the sheet has stopped scrolling and re-laying out under it. */
async function settledBox(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  let previous = await control.boundingBox();
  for (let poll = 0; poll < SETTLE_MAX_POLLS; poll++) {
    await control.page().waitForTimeout(SETTLE_POLL_MS);
    const next = await control.boundingBox();
    if (previous && next && previous.x === next.x && previous.y === next.y) return next;
    previous = next;
  }
  throw new Error("The control never settled");
}

/**
 * Explanations open from an (i): on hover with a mouse and on a press
 * everywhere else. The sheet has one view, no Simple or Detailed switch, and an
 * open panel never traps the field being edited.
 */
const SPLIT_FORMULA = /^Dry = wet × \(1 - moisture\)\. 50 kg × \(1 - 15%\) = 42\.5 kg\.$/;

for (const width of [DESKTOP_WIDTH, PHONE_WIDTH]) {
  test(`the feedstock split explains itself behind an (i) at ${width}px`, async ({ adminPage: page, seededData }) => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: /New production run/i }).click();
    await waitForSideSheet(page);
    const dialog = page.getByRole("dialog").first();
    await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: "Detailed", exact: true })).toHaveCount(0);

    await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
    // Nothing explains an empty split, so there is no (i) and no unresolved bar before the first value.
    const info = dialog.getByRole("button", { name: "About Feedstock composition" });
    await expect(info).toHaveCount(0);
    await expect(dialog.getByText(/not recorded/i)).toHaveCount(0);
    await dialog.locator('input[name="feedstockDraws.0.wetMassKg"]').fill(WET_MASS_KG);
    await dialog.locator('input[name="feedstockMoisturePercent"]').fill(MOISTURE_PERCENT);

    // The formula sentence stays inline; the ledger waits behind the (i).
    await expect(dialog.getByText(SPLIT_FORMULA)).toBeVisible();
    const ledger = page.getByRole("table", { name: /^Feedstock composition/ });
    await expect(ledger).toHaveCount(0);
    await expect(info).toBeVisible();

    // A press opens the panel, at any width.
    await info.click();
    await expect(ledger).toBeVisible();
    const panel = page.getByRole("dialog", { name: "Feedstock composition", exact: true });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width < PHONE_MAX_WIDTH) expect(box!.width).toBeLessThanOrEqual(width - 2 * PANEL_GUTTER_PX);
    // An open panel adds no horizontal scroll to the sheet or the page.
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // An outside press closes it and still reaches the field being edited.
    const moisture = dialog.locator('input[name="feedstockMoisturePercent"]');
    await moisture.click();
    await moisture.fill(EDITED_MOISTURE_PERCENT);
    await expect(ledger).toHaveCount(0);
    await expect(moisture).toHaveValue(EDITED_MOISTURE_PERCENT);

    // Escape closes it too.
    await info.click();
    await expect(ledger).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ledger).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
}

test("the open panel stays inside the sheet at 1440px", async ({ adminPage: page, seededData }) => {
  await page.setViewportSize({ width: DESKTOP_WIDTH, height: VIEWPORT_HEIGHT });
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await page.getByRole("button", { name: /New production run/i }).click();
  await waitForSideSheet(page);
  const dialog = page.getByRole("dialog").first();
  await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
  await dialog.locator('input[name="feedstockDraws.0.wetMassKg"]').fill(WET_MASS_KG);
  await dialog.locator('input[name="feedstockMoisturePercent"]').fill(MOISTURE_PERCENT);
  const info = dialog.getByRole("button", { name: "About Feedstock composition" });
  await info.evaluate(el => el.scrollIntoView({ block: "center" }));
  await settledBox(info);
  await info.click();
  const panel = page.getByRole("dialog", { name: "Feedstock composition", exact: true });
  await expect(panel).toBeVisible();
  const sheetBox = (await dialog.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(sheetBox.x);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width);
});

test("a mouse hover opens the explanation on desktop", async ({ adminPage: page, seededData }) => {
  await page.setViewportSize({ width: DESKTOP_WIDTH, height: VIEWPORT_HEIGHT });
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await page.getByRole("button", { name: /New production run/i }).click();
  await waitForSideSheet(page);
  const dialog = page.getByRole("dialog").first();
  await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
  await dialog.locator('input[name="feedstockDraws.0.wetMassKg"]').fill(WET_MASS_KG);
  await dialog.locator('input[name="feedstockMoisturePercent"]').fill(MOISTURE_PERCENT);
  const info = dialog.getByRole("button", { name: "About Feedstock composition" });
  const box = await settledBox(info);
  // A real pointer arrives over several moves.
  await page.mouse.move(box.x - POINTER_APPROACH_PX.x, box.y - POINTER_APPROACH_PX.y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: POINTER_STEPS });
  await expect(page.getByRole("table", { name: /^Feedstock composition/ })).toBeVisible();
});
