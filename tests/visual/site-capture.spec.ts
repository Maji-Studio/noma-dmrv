/**
 * Marketing-site screenshots (docs/site.md). Opt-in: runs only with SITE_CAPTURE=1
 * against a running site server; the base URL comes from NEXT_PUBLIC_APP_URL via
 * playwright.visual.config.ts, which keeps the localhost guard. No sign-in, no
 * writes. Imports come from @playwright/test: the E2E fixtures are app-only.
 *
 *   pnpm site:dev   # :3120, in another terminal
 *   SITE_CAPTURE=1 NEXT_PUBLIC_APP_URL=http://localhost:3120 \
 *     pnpm exec playwright test -c playwright.visual.config.ts site-capture
 *
 * Knobs: SITE_CAPTURE_OUT (output dir), SITE_CAPTURE_PAGES (comma-separated
 * paths), SITE_CAPTURE_VIEWPORTS (e.g. "1440x900,390x844"). Full-page PNGs land
 * in <out>/<page>-<width>.png.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";

const DEFAULT_PAGES = ["/", "/product", "/why", "/get-started"];
const DEFAULT_VIEWPORTS = "1440x900,390x844";
const DEFAULT_OUT = "test-results/site-capture";

const pages = (process.env.SITE_CAPTURE_PAGES ?? DEFAULT_PAGES.join(","))
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const viewports = (process.env.SITE_CAPTURE_VIEWPORTS ?? DEFAULT_VIEWPORTS).split(",").map((v) => {
  const [width, height] = v.trim().split("x").map(Number);
  return { width, height };
});
const outDir = process.env.SITE_CAPTURE_OUT ?? DEFAULT_OUT;

test.skip(process.env.SITE_CAPTURE !== "1", "set SITE_CAPTURE=1 to capture the site");

test("capture site pages", async ({ page }) => {
  mkdirSync(outDir, { recursive: true });
  // Motion replays what is already on the page; reduced motion captures the end state.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const pagePath of pages) {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      const name = pagePath === "/" ? "home" : pagePath.replace(/^\//, "").replaceAll("/", "-");
      const file = path.join(outDir, `${name}-${viewport.width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`captured ${file}`);
    }
  }
});
