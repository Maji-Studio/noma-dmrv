/**
 * TEMPORARY — regression sweep for the app-shell scrollport change.
 *
 * `src/app/(app)/layout.tsx` gained `md:h-screen md:overflow-hidden`, which
 * moves the desktop scrollbar from the window into `main`. `main` already
 * carried `overflow-auto`, so it was already the scrollport for every
 * `position: sticky` descendant — it just never scrolled, which broke sticky
 * silently on every page. This spec proves the new frame across a
 * representative set of routes rather than on the one page that needed it.
 *
 * One `test()` on purpose: the dev server on :3100 runs from `.env.local`,
 * which does not set DISABLE_RATE_LIMIT, and the auth fixture signs in per
 * worker. Keep the sign-in count at one.
 *
 * Delete this file once the change has shipped and settled.
 */
import { test, expect } from "./fixtures/auth-fixtures";

const FACILITY = "6769395d-12f9-4996-abd4-d0570f4f10fd";

/** Slack for sub-pixel layout rounding — Chromium reports fractional sizes. */
const SLOP = 2;

/**
 * Routes that must survive the change. `full` marks the two full-bleed canvas
 * surfaces, which size themselves to the viewport and so must NOT scroll at
 * all; every other route is expected to be a normal scrolling page.
 */
const ROUTES: { path: string; label: string; full?: boolean }[] = [
  { path: "/dashboard", label: "dashboard (flow hero)" },
  { path: "/production-runs", label: "production runs (data table)" },
  { path: "/credit-batches", label: "credit batches (card list)" },
  { path: "/storage-locations", label: "storage board" },
  { path: "/samples", label: "samples" },
  { path: "/applications", label: "applications" },
  { path: "/feedstocks", label: "feedstocks" },
  { path: "/facilities", label: "facilities" },
  { path: "/certification", label: "certification hub" },
  { path: "/certification/settings", label: "certification settings" },
  { path: "/settings/organization", label: "organization settings" },
  { path: "/traceability", label: "traceability (DAG)", full: true },
  { path: "/chain-of-custody", label: "chain of custody (map)", full: true },
];

interface ScrollProbe {
  docScrollWidth: number;
  innerWidth: number;
  docScrollHeight: number;
  innerHeight: number;
  mainScrollWidth: number;
  mainClientWidth: number;
  mainScrollHeight: number;
  mainClientHeight: number;
  /** Where `main` lands when asked to scroll past its own end. */
  mainMaxScrollTop: number;
}

async function probe(page: import("@playwright/test").Page): Promise<ScrollProbe> {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    const before = main.scrollTop;
    main.scrollTop = 1e7;
    const mainMaxScrollTop = main.scrollTop;
    main.scrollTop = before;
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      mainScrollWidth: main.scrollWidth,
      mainClientWidth: main.clientWidth,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      mainMaxScrollTop,
    };
  });
}

test("app shell scrollport holds across routes", async ({ adminPage: page }) => {
  test.setTimeout(600_000);

  // Attribute each console error to the route that was loaded when it fired,
  // so a pre-existing error on an unrelated page cannot be mistaken for a
  // regression from the shell change.
  const errors: string[] = [];
  let current = "(before first navigation)";
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${current} :: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${current} :: pageerror: ${e.message}`));

  for (const route of ROUTES) {
    const url = `${route.path}?facility=${FACILITY}`;
    current = route.label;

    // ---- Desktop: `main` owns the scrollbar, the window has none. ----
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    // Turbopack can serve the shell before the route's own content mounts.
    // `.first()` because the traceability page renders its own nested `<main>`
    // inside the shell's — pre-existing, and `probe()` reads the shell's one.
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForTimeout(300);

    const d = await probe(page);
    console.log(`[shell] 1440 ${route.label}: ${JSON.stringify(d)}`);

    expect(
      d.docScrollWidth,
      `horizontal overflow on the document at 1440 — ${route.label}`,
    ).toBeLessThanOrEqual(d.innerWidth + SLOP);
    expect(
      d.mainScrollWidth,
      `horizontal overflow inside main at 1440 — ${route.label}`,
    ).toBeLessThanOrEqual(d.mainClientWidth + SLOP);

    // The whole point of the change: exactly one vertical scroller on desktop.
    // A scrollable window here means content escaped the fixed frame and the
    // page has two nested scrollbars.
    expect(
      d.docScrollHeight,
      `the window must not scroll on desktop — ${route.label}`,
    ).toBeLessThanOrEqual(d.innerHeight + SLOP);

    // Nothing may be stranded past `main`'s reachable scroll range. This is
    // the assertion that would catch content clipped by md:overflow-hidden.
    expect(
      d.mainMaxScrollTop + d.mainClientHeight,
      `content unreachable by scrolling main — ${route.label}`,
    ).toBeGreaterThanOrEqual(d.mainScrollHeight - SLOP);

    if (route.full) {
      // Full-bleed canvases size to the frame, so they must not scroll either.
      expect(
        d.mainScrollHeight,
        `full-bleed canvas should fit its frame — ${route.label}`,
      ).toBeLessThanOrEqual(d.mainClientHeight + SLOP);
    }

    // ---- Mobile: unchanged, the window scrolls and main does not. ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const m = await probe(page);
    console.log(`[shell] 390 ${route.label}: ${JSON.stringify(m)}`);

    expect(
      m.docScrollWidth,
      `horizontal overflow on the document at 390 — ${route.label}`,
    ).toBeLessThanOrEqual(m.innerWidth + SLOP);
    expect(
      m.mainScrollWidth,
      `horizontal overflow inside main at 390 — ${route.label}`,
    ).toBeLessThanOrEqual(m.mainClientWidth + SLOP);
    // Below `md` the wrapper is min-h-screen again, so main grows with its
    // content and the window is the only scroller. A scrollable main here
    // would mean the desktop frame leaked into the mobile breakpoint.
    expect(
      m.mainScrollHeight,
      `main must not scroll independently at 390 — ${route.label}`,
    ).toBeLessThanOrEqual(m.mainClientHeight + SLOP);
  }

  // ---- The mobile drawer still opens and scrolls its own nav. ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard?facility=${FACILITY}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  const drawerNav = await page.evaluate(() => {
    const nav = document.querySelector('[role="dialog"] nav');
    if (!nav) return null;
    return { scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight };
  });
  console.log(`[shell] mobile drawer nav: ${JSON.stringify(drawerNav)}`);
  expect(drawerNav, "mobile drawer nav must render").not.toBeNull();
  await page.keyboard.press("Escape");

  // ---- A side sheet's own scroll container still works on desktop. ----
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(`/feedstocks?facility=${FACILITY}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New Feedstock" }).first().click();
  const sheet = page.getByRole("dialog").first();
  await expect(sheet).toBeVisible();
  const sheetScroll = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const scrollers = Array.from(dialog.querySelectorAll<HTMLElement>("*")).filter(
      (el) => el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY),
    );
    const target = scrollers[0];
    if (!target) return { scrollerCount: 0, moved: 0 };
    target.scrollTop = 1e7;
    return { scrollerCount: scrollers.length, moved: target.scrollTop };
  });
  console.log(`[shell] side sheet scroll: ${JSON.stringify(sheetScroll)}`);
  expect(sheetScroll, "side sheet must render").not.toBeNull();
  // Its footer stays pinned while its body scrolls — the sticky contract the
  // shell change was supposed to fix rather than break.
  const submit = sheet.getByRole("button", { name: /Save|Create|Record/i }).first();
  await expect(submit).toBeInViewport();

  // One per line so the output survives Playwright's line reporter rewriting
  // the terminal (a single JSON blob gets buried under cursor escapes).
  for (const e of errors) console.log(`[shell][console-error] ${e}`);
  console.log(`[shell] console error count: ${errors.length}`);

  // The two pure `redirect()` routes log "Rendered more hooks than during the
  // previous render" in dev, plus a Performance.measure negative-timestamp
  // error. Both are PRE-EXISTING and unrelated to the shell frame: verified
  // 2026-07-28 by running zz-redirect-route-errors.spec.ts with the
  // `md:h-screen md:overflow-hidden` change reverted, which reproduces the same
  // signature. The failure mode is the one already documented in
  // select-facility-empty-state.tsx — Next's Router hydration when a page-level
  // redirect() streams in. So assert on everything EXCEPT those routes.
  const REDIRECT_ROUTES = ["certification hub", "chain of custody (map)"];
  const unexpected = errors.filter(
    (e) => !REDIRECT_ROUTES.some((r) => e.startsWith(`${r} ::`)),
  );
  expect(unexpected, "console errors outside the known redirect routes").toEqual(
    [],
  );
});
