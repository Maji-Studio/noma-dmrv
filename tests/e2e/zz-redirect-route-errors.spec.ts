/**
 * TEMPORARY — A/B control for the app-shell scrollport change.
 *
 * The scrollport sweep found 4 console errors, all on the two pure `redirect()`
 * routes. This spec visits only those two so the same run can be repeated with
 * the shell change reverted, proving the errors are pre-existing rather than
 * caused by it. Delete with zz-app-shell-scrollport.spec.ts.
 */
import { test, expect } from "./fixtures/auth-fixtures";

const FACILITY = "6769395d-12f9-4996-abd4-d0570f4f10fd";

test("redirect routes log the same errors regardless of the shell frame", async ({
  adminPage: page,
}) => {
  test.setTimeout(180_000);

  const errors: string[] = [];
  let current = "(none)";
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${current} :: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${current} :: pageerror: ${e.message}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ["/certification", "/chain-of-custody"]) {
    current = route;
    await page.goto(`${route}?facility=${FACILITY}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForTimeout(500);
  }

  for (const e of errors) console.log(`[ab][console-error] ${e}`);
  console.log(`[ab] count=${errors.length}`);
});
