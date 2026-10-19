/** Opt-in, read-only geometry regression for #959. Uses existing seeded
 * options and changes unsaved form values only. No submit or entity writes.
 */
import { test, expect } from "./form-capture-fixture";
import { loadCaptureContext } from "./form-capture-context";
import { MANIFEST } from "./form-capture-manifest";
import { measureFormGeometry } from "./form-geometry";
import { measureNativePickerIcons } from "./native-picker-geometry";
import { settle } from "./form-capture-helpers";

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const TEST_TIMEOUT_MS = 240_000;
const TOUCH_TARGET_PX = 44;
const CHEVRON_CLICK_INSET_PX = 20;
// The Clear hit area ends exactly where the chevron starts; allow subpixel layout rounding.
const EDGE_TOUCH_TOLERANCE_PX = 1;
const MIDPOINT_DIVISOR = 2;

test.skip(process.env.FORM_CAPTURE !== "1", "Opt-in: set FORM_CAPTURE=1.");

test("trailing icons keep their edge inset and independent click targets", async ({ capture }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const page = capture.page;
  const ctx = await loadCaptureContext();
  const surface = MANIFEST.find((item) => item.id === "production-run.create")!;
  const root = await surface.open(page, ctx);
  if (typeof root === "string") throw new Error(root);
  await settle(page, root);
  await root.evaluate((el) => el.setAttribute("data-capture-root", ""));
  const trigger = root.locator('#reactorId[data-testid="entity-select-trigger"]');
  await expect(trigger).toBeEnabled();
  const clear = trigger.locator("..").getByTestId("entity-select-clear");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    if (await clear.count()) await clear.click();
    await expect(trigger).toHaveAttribute("data-has-value", "false");
    let geometry = await page.evaluate(measureFormGeometry, { kind: "sheet" as const, mode: "form" as const, nativePickerIcons: await measureNativePickerIcons(page) });
    expect(geometry.trailingIcons.find((icon) => icon.field === "reactorId")).toMatchObject({ state: "empty", valid: true });

    await trigger.click();
    await page.locator('[role="option"]:not([aria-disabled="true"])').first().click();
    await expect(clear).toBeVisible();
    // The chevron rotates back when the menu closes; a mid-rotation box is wider than the glyph.
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger.locator("[data-trailing-icon]")).toHaveCSS("rotate", "none");
    const hitBox = (await clear.boundingBox())!;
    expect(hitBox.width).toBe(TOUCH_TARGET_PX);
    expect(hitBox.height).toBe(TOUCH_TARGET_PX);
    const caret = (await trigger.locator("[data-trailing-icon]").boundingBox())!;
    const x = (await clear.locator("svg").boundingBox())!;
    expect(hitBox.x + hitBox.width).toBeLessThanOrEqual(caret.x + EDGE_TOUCH_TOLERANCE_PX);
    expect(x.x + x.width).toBeLessThan(caret.x);

    // Click the chevron with a value present: the Clear hit area must not steal it.
    const box = (await trigger.boundingBox())!;
    await trigger.click({ position: { x: box.width - CHEVRON_CLICK_INSET_PX, y: box.height / MIDPOINT_DIVISOR } });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger.locator("[data-trailing-icon]")).toHaveCSS("rotate", "none");
    geometry = await page.evaluate(measureFormGeometry, { kind: "sheet" as const, mode: "form" as const, nativePickerIcons: await measureNativePickerIcons(page) });
    expect(geometry.trailingIcons.find((icon) => icon.field === "reactorId")).toMatchObject({ state: "filled", valid: true });
    for (const [type, value] of [["date", "2026-10-13"], ["time", "08:35"]]) {
      const input = root.locator(`input[type="${type}"]`).first();
      for (const entry of ["", value]) {
        await input.fill(entry);
        geometry = await page.evaluate(measureFormGeometry, { kind: "sheet" as const, mode: "form" as const, nativePickerIcons: await measureNativePickerIcons(page) });
        const sample = geometry.trailingIcons.find((icon) => icon.field === (type === "date" ? "startDate" : "startTime"));
        expect(sample).toMatchObject({ state: entry ? "filled" : "empty", valid: true });
      }
    }
  }

  const product = MANIFEST.find((item) => item.id === "product.create")!;
  // Facility hydration is read from the sidebar, which is hidden at mobile width.
  await page.setViewportSize(VIEWPORTS[0]);
  const productRoot = await product.open(page, ctx);
  if (typeof productRoot === "string") throw new Error(productRoot);
  await root.evaluate((el) => el.removeAttribute("data-capture-root")).catch(() => undefined);
  await productRoot.evaluate((el) => el.setAttribute("data-capture-root", ""));
  const datetime = productRoot.locator('input[type="datetime-local"]').first();
  await expect(datetime).toBeVisible();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const value of ["", "2026-10-13T08:35"]) {
      await datetime.fill(value);
      await settle(page, productRoot);
      const geometry = await page.evaluate(measureFormGeometry, { kind: "sheet" as const, mode: "form" as const, nativePickerIcons: await measureNativePickerIcons(page) });
      expect(geometry.trailingIcons.find((icon) => icon.kind === "datetime-local")).toMatchObject({ state: value ? "filled" : "empty", valid: true });
    }
  }
});
