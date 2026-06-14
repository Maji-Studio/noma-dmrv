/**
 * Mobile Responsiveness E2E — regression guard for the mobile/operator pass.
 *
 * Locks in the invariants that the responsive pass established at a phone
 * viewport (390×844, iPhone 12/13/14 class):
 *
 *  1. No horizontal overflow on any primary route — the #1 mobile-layout bug
 *     class. An un-wrapped wide table or a non-stacked `grid-cols-N` form would
 *     push `document` wider than the viewport and fail the sweep.
 *  2. The mobile chrome is present: the desktop rail is hidden and the sticky
 *     top bar + hamburger drawer (`MobileNav`) takes over below `md`.
 *  3. `DataTable` swaps its desktop `<table>` for the stacked card view, and
 *     those cards stay keyboard-reachable (`role="button"` + `tabindex=0`).
 *
 * Method mirrors the desktop specs: auth via the HTTP API (`adminPage`
 * fixture), seeded chain data for facility scoping. The viewport override is
 * applied at the file level so every test runs as a phone.
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// iPhone 12/13/14 logical viewport — the size the pass was verified at.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Primary `(app)` routes. Every list page shares the auto card-view, so this
// doubles as the breadth sweep the manual pass would otherwise eyeball.
const ROUTES = [
  "/dashboard",
  "/facilities",
  "/reactors",
  "/production-runs",
  "/feedstocks",
  "/samples",
  "/biochar-products",
  "/orders",
  "/deliveries",
  "/applications",
  "/credit-batches",
  "/customers",
  "/suppliers",
  "/storage-locations",
  "/formulations",
  "/energy",
  "/certification",
  "/certification/settings",
  "/certification/removals",
  "/certification/ghg-statements",
  "/chain-of-custody",
  "/admin",
  "/admin/users",
] as const;

test.use({ viewport: MOBILE_VIEWPORT });

/**
 * Fail if the document scrolls horizontally. A child element with its own
 * `overflow-x-auto` (e.g. the cert settings tab bar) does NOT widen the
 * document, so this only catches layout that escapes the viewport — exactly
 * the un-wrapped-table / non-stacked-grid regression we guard against.
 */
async function expectNoHorizontalOverflow(page: Page, route: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${route}: document overflows horizontally (scrollWidth ${scrollWidth}px > viewport ${clientWidth}px)`,
  ).toBeLessThanOrEqual(clientWidth + 1); // 1px sub-pixel rounding tolerance
}

const hamburger = (page: Page) =>
  page.getByRole("button", { name: "Open navigation menu" });

test.describe("Mobile responsiveness (390×844)", () => {
  for (const route of ROUTES) {
    test(`no horizontal overflow + mobile chrome on ${route}`, async ({
      adminPage,
      seededData,
    }) => {
      const page = adminPage;
      await page.goto(`${route}?facility=${seededData.facility.id}`);

      // The sticky top bar renders with the shell, before data resolves.
      await expect(hamburger(page)).toBeVisible();
      // Desktop rail (`hidden md:flex`) must not be on screen at this width.
      await expect(page.getByRole("complementary")).toBeHidden();

      // Let async data settle so a late-loading wide table is included in the
      // overflow check; cap the wait since React Query polling never idles.
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

      await expectNoHorizontalOverflow(page, route);
    });
  }

  test("nav drawer opens, lists links, and closes via button and Escape", async ({
    adminPage,
    seededData,
  }) => {
    const page = adminPage;
    await page.goto(`/dashboard?facility=${seededData.facility.id}`);

    await hamburger(page).click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: /Dashboard/i })).toBeVisible();

    // Close button dismisses.
    await page.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(drawer).toBeHidden();

    // Esc dismisses (inherited from the Base UI Dialog primitive).
    await hamburger(page).click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("DataTable swaps to keyboard-reachable cards (no desktop table) on mobile", async ({
    adminPage,
    seededData,
  }) => {
    const page = adminPage;
    // `/reactors` wires `onRowClick` and is facility-scoped, and `seedChainData`
    // seeds a reactor under the facility — so `?facility=<id>` reliably renders
    // a clickable card row in both dev and CI. (`/facilities` rows aren't
    // clickable; `/orders` isn't seeded — neither exercises the card contract.)
    await page.goto(`/reactors?facility=${seededData.facility.id}`);
    await expect(hamburger(page)).toBeVisible();

    // Let the async reactor query resolve so the rows exist before asserting.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // No desktop `<table>` is visible below `md` (the `hidden md:block` wrapper
    // collapses it); the stacked card view takes over.
    await expect(page.getByRole("table")).toBeHidden();

    // The seeded reactor renders as a card row that is keyboard-focusable —
    // the a11y contract the card view must preserve. The mobile card is a
    // `<div role="button">`, distinct from the (hidden) desktop `<tr>`.
    const card = page.locator('div[role="button"][tabindex="0"]').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.focus();
    await expect(card).toBeFocused();

    await expectNoHorizontalOverflow(page, "/reactors (card view)");
  });

  test("entity view sheet stacks paired detail fields to one column on mobile", async ({
    adminPage,
    seededData,
  }) => {
    const page = adminPage;
    // Open the seeded reactor's read-only view sheet via its mobile card row.
    await page.goto(`/reactors?facility=${seededData.facility.id}`);
    await expect(hamburger(page)).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.locator('div[role="button"][tabindex="0"]').first().click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible({ timeout: 15000 });

    // "Code" and "Identifier" are paired in one DetailRow. At desktop they sit
    // side-by-side (same row); below `sm` the row must stack so a long value
    // gets the full sheet width instead of a wrapping ~170px half-column. Assert
    // the Identifier label renders clearly BELOW the Code label — i.e. stacked,
    // not beside it. (Guards the DetailRow `flex-col sm:flex-row` contract.)
    const codeBox = await sheet.getByText("Code", { exact: true }).boundingBox();
    const idBox = await sheet.getByText("Identifier", { exact: true }).boundingBox();
    expect(codeBox).not.toBeNull();
    expect(idBox).not.toBeNull();
    expect(
      idBox!.y,
      "Identifier should stack below Code on a phone, not sit beside it",
    ).toBeGreaterThan(codeBox!.y + 16);
  });
});
