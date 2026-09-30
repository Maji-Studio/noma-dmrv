/**
 * Form capture harness (docs/plans/2026-09-29-form-cleanup.md, "Browser
 * rescan", Instrument A). Opt-in: runs only with FORM_CAPTURE=1 against a
 * running, seeded dev server (pnpm db:seed). One test loops the surface
 * manifest so the capture signs in once.
 *
 * What it writes: nothing in the entity tables. The fixture
 * (form-capture-fixture.ts) signs in as the existing local admin, which
 * creates one session row, sets its active organization, and deletes it at
 * sign-out. The validation-error state submits with every non-GET request
 * aborted, and a form that still tries to save is not captured.
 *
 *   FORM_CAPTURE=1 FORM_CAPTURE_LABEL=baseline NEXT_PUBLIC_APP_URL=http://localhost:3105 \
 *     pnpm exec playwright test -c playwright.visual.config.ts
 *
 * Knobs: FORM_CAPTURE_OUT (output dir), FORM_CAPTURE_LABEL, FORM_CAPTURE_FAMILY
 * (one family), FORM_CAPTURE_SURFACES (comma-separated id prefixes),
 * FORM_CAPTURE_VIEWPORTS (e.g. "1440x900,390x844"), FORM_CAPTURE_FACILITY
 * (facility code; must exist), FORM_CAPTURE_EMAIL / FORM_CAPTURE_PASSWORD
 * (defaults: ADMIN_EMAIL / ADMIN_PASSWORD from .env.local).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, Locator, Page } from "@playwright/test";
import { test, expect, type CaptureSession } from "./form-capture-fixture";
import { measureFormGeometry, type Geometry } from "./form-geometry";
import {
  diffR1,
  evaluateGeometry,
  writeGeometry,
  writeSummary,
  type CaptureRun,
  type SurfaceRecord,
} from "./form-capture-report";
import { FAMILIES, MANIFEST, type Surface } from "./form-capture-manifest";
import { loadCaptureContext, type CaptureContext } from "./form-capture-context";
import { hideDevOverlay, settle, withWritesBlocked } from "./form-capture-helpers";

const DEFAULT_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
];
/** Per-surface budget; the whole run gets this times the surface count. */
const SURFACE_BUDGET_MS = 240_000;
const ACTION_TIMEOUT_MS = 20_000;
const NAVIGATION_TIMEOUT_MS = 180_000;
/** Lets layout settle after the viewport is stretched to the content height. */
const RESIZE_SETTLE_MS = 250;
/** Tallest capture; a sheet longer than this is cropped at the bottom. */
const MAX_CAPTURE_HEIGHT = 9_000;
const ERROR_WAIT_MS = 1_200;
/** Lines of a Playwright error kept as a failed surface's reason. */
const ERROR_MESSAGE_LINES = 2;
const ANONYMOUS_LOCALE = "en-US";

const enabled = process.env.FORM_CAPTURE === "1";
const label = process.env.FORM_CAPTURE_LABEL ?? "baseline";
const outDir = process.env.FORM_CAPTURE_OUT ?? path.join("/tmp/form-cleanup-audits/capture", label);
const familyFilter = process.env.FORM_CAPTURE_FAMILY ?? null;
const surfaceFilter = process.env.FORM_CAPTURE_SURFACES?.split(",").map((item) => item.trim()).filter(Boolean) ?? null;
const viewports = process.env.FORM_CAPTURE_VIEWPORTS
  ? process.env.FORM_CAPTURE_VIEWPORTS.split(",").map((item) => {
      const [width, height] = item.trim().split("x").map(Number);
      if (!width || !height) throw new Error(`Bad FORM_CAPTURE_VIEWPORTS entry "${item}", expected WIDTHxHEIGHT.`);
      return { width, height };
    })
  : DEFAULT_VIEWPORTS;

if (familyFilter && !FAMILIES.includes(familyFilter as (typeof FAMILIES)[number])) {
  throw new Error(`Unknown FORM_CAPTURE_FAMILY "${familyFilter}". Use one of: ${FAMILIES.join(", ")}.`);
}

const selected = MANIFEST.filter(
  (surface) =>
    (!familyFilter || surface.family === familyFilter) &&
    (!surfaceFilter || surfaceFilter.some((prefix) => surface.id.startsWith(prefix))),
);

test.skip(!enabled, "Opt-in capture: set FORM_CAPTURE=1.");

/** Marks the element the in-page measurer treats as the surface root. */
async function markRoot(page: Page, root: Locator) {
  await page.evaluate(() => document.querySelectorAll("[data-capture-root]").forEach((el) => el.removeAttribute("data-capture-root")));
  await root.evaluate((el) => el.setAttribute("data-capture-root", ""));
}

async function dismissToasts(page: Page) {
  for (const button of await page.getByRole("button", { name: "Dismiss notification", exact: true }).all()) {
    await button.click().catch(() => undefined);
  }
  await page.mouse.move(0, 0);
}

/** How tall the viewport must be for the surface to render without scrolling. */
async function contentHeight(page: Page, surface: Surface): Promise<number> {
  return page.evaluate((kind) => {
    const root = document.querySelector("[data-capture-root]") as HTMLElement;
    const extra = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);
    if (kind === "sheet") {
      const body = Array.from(root.children).find((child) => /auto|scroll/.test(getComputedStyle(child).overflowY)) as HTMLElement | undefined;
      return window.innerHeight + (body ? extra(body) : 0);
    }
    if (kind === "dialog") return window.innerHeight + extra(root);
    const scrollers = Array.from(document.querySelectorAll<HTMLElement>("body, body *")).filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY));
    return window.innerHeight + Math.max(extra(document.documentElement), ...scrollers.map(extra));
  }, surface.kind);
}

async function screenshot(page: Page, surface: Surface, root: Locator, file: string, mask: Locator[]) {
  const viewport = page.viewportSize()!;
  const height = Math.min(MAX_CAPTURE_HEIGHT, Math.ceil(await contentHeight(page, surface)));
  if (height > viewport.height) {
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(RESIZE_SETTLE_MS);
  }
  if (surface.kind === "page") await page.screenshot({ path: file, animations: "disabled", mask });
  else await root.screenshot({ path: file, animations: "disabled", mask });
  if (height > viewport.height) await page.setViewportSize(viewport);
}

async function captureState(page: Page, surface: Surface, root: Locator, state: string, record: SurfaceRecord, mask: Locator[]): Promise<Geometry> {
  const viewport = page.viewportSize()!;
  await settle(page, root);
  await dismissToasts(page);
  await markRoot(page, root);
  const geometry = await page.evaluate(measureFormGeometry, { kind: surface.kind, mode: surface.mode });
  const { violations, failures } = evaluateGeometry(geometry, surface.mode);
  const png = `${surface.id}__${state}__${viewport.width}x${viewport.height}.png`;
  await screenshot(page, surface, root, path.join(outDir, png), mask);
  record.states.push({ state, viewport: `${viewport.width}x${viewport.height}`, png, geometry, violations, failures });
  return geometry;
}

async function detailToggle(root: Locator) {
  const radio = root.getByRole("radio", { name: "Simple", exact: true });
  return (await radio.count()) > 0;
}

async function setLevel(root: Locator, level: "simple" | "detailed") {
  const name = level === "simple" ? "Simple" : "Detailed";
  const radio = root.getByRole("radio", { name, exact: true }).first();
  if (await radio.isChecked()) return;
  await radio.locator("..").click();
  await expect(radio).toBeChecked();
}

/**
 * Submits the empty form once with every non-GET request aborted (server
 * actions are POSTs), so a form that passes client validation still cannot
 * write. Returns why the error state cannot be captured, or null when
 * client-side errors are showing.
 */
async function showValidationErrors(page: Page, root: Locator): Promise<string | null> {
  const submit = root.locator('button[type="submit"]').last();
  if ((await submit.count()) === 0) return "the form has no submit button";
  if (await submit.isDisabled()) return "the submit button is disabled while the form is empty";
  const { attempted } = await withWritesBlocked(page, async () => {
    await submit.click();
    await page.waitForTimeout(ERROR_WAIT_MS);
  });
  if (attempted > 0) return "the empty submit sent a request, so the form passed client validation (request aborted, nothing written); not captured";
  const invalid = await root.locator('[aria-invalid="true"]').count();
  return invalid > 0 ? null : "the empty submit showed no field errors";
}

async function captureSurface(session: CaptureSession, browser: Browser, surface: Surface, ctx: CaptureContext): Promise<SurfaceRecord> {
  const record: SurfaceRecord = {
    id: surface.id,
    family: surface.family,
    title: surface.title,
    kind: surface.kind,
    mode: surface.mode,
    status: "captured",
    skippedStates: [],
    states: [],
  };
  const skip = surface.skip?.(ctx);
  if (skip) return { ...record, status: "skipped", reason: skip };

  let target = session.page;
  let anonymous: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  if (surface.anonymous) {
    anonymous = await browser.newContext({ baseURL: session.baseURL, locale: ANONYMOUS_LOCALE });
    target = await anonymous.newPage();
    target.setDefaultTimeout(ACTION_TIMEOUT_MS);
    target.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await hideDevOverlay(target);
  }
  const mask = surface.anonymous ? [] : session.accountMask();
  try {
    await target.setViewportSize(viewports[0]);
    const opened = await surface.open(target, ctx);
    if (typeof opened === "string") return { ...record, status: "skipped", reason: opened };
    const root = opened;
    const levels = (await detailToggle(root)) ? (["simple", "detailed"] as const) : null;
    const fill = surface.fill === "none" ? "" : `-${surface.fill}`;
    const r1: Partial<Record<"simple" | "detailed", Geometry["r1"]>> = {};
    for (const viewport of viewports) {
      await target.setViewportSize(viewport);
      if (!levels) {
        await captureState(target, surface, root, `default${fill}`, record, mask);
        continue;
      }
      for (const level of levels) {
        await setLevel(root, level);
        const geometry = await captureState(target, surface, root, `${level}${fill}`, record, mask);
        // R1 compares the levels once, at the first (widest) viewport.
        if (viewport === viewports[0]) r1[level] = geometry.r1;
      }
    }
    if (r1.simple && r1.detailed) record.r1 = diffR1(r1.simple, r1.detailed);
    if (surface.errors) {
      await target.setViewportSize(viewports[0]);
      if (levels) await setLevel(root, "simple");
      const blocked = await showValidationErrors(target, root);
      if (!blocked) {
        // Errors stay on screen through a level switch: capture Simple, then Detailed.
        for (const level of levels ?? [null]) {
          if (level) await setLevel(root, level);
          for (const viewport of viewports) {
            await target.setViewportSize(viewport);
            await captureState(target, surface, root, `${level ?? "default"}-errors`, record, mask);
          }
        }
      } else {
        record.skippedStates.push({ state: "errors", reason: blocked });
      }
    }
    return record;
  } catch (error) {
    // Strip ANSI colour codes Playwright adds to assertion messages.
    const message = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[\d+m/g, "").split("\n").slice(0, ERROR_MESSAGE_LINES).join(" ");
    await target.screenshot({ path: path.join(outDir, `${surface.id}__failed.png`), mask }).catch(() => undefined);
    return { ...record, status: "failed", reason: message };
  } finally {
    await anonymous?.close();
  }
}

test("form capture", async ({ capture, browser }) => {
  const { page } = capture;
  test.setTimeout(SURFACE_BUDGET_MS * Math.max(1, selected.length));
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  mkdirSync(outDir, { recursive: true });
  await hideDevOverlay(page);
  const ctx = await loadCaptureContext();
  const run: CaptureRun = {
    label,
    baseURL: capture.baseURL,
    facility: ctx.facility.code,
    startedAt: new Date().toISOString(),
    viewports: viewports.map((viewport) => `${viewport.width}x${viewport.height}`),
    family: familyFilter,
    surfaces: [],
  };
  for (const surface of selected) {
    const record = await captureSurface(capture, browser, surface, ctx);
    run.surfaces.push(record);
    console.log(`[form-capture] ${record.status.padEnd(8)} ${surface.id}${record.reason ? ` (${record.reason})` : ""}`);
    writeGeometry(outDir, run);
  }
  run.finishedAt = new Date().toISOString();
  writeGeometry(outDir, run);
  writeSummary(outDir, run);
  const failed = run.surfaces.filter((surface) => surface.status === "failed").map((surface) => `${surface.id}: ${surface.reason}`);
  expect(failed, `Surfaces that failed to open; see ${outDir}/summary.md`).toEqual([]);
});
