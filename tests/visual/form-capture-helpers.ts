/**
 * Page helpers and seeded-data lookup for the form capture harness. Nothing
 * here writes: helpers only navigate, open sheets and dialogs, and read the
 * database to find the seeded Mafinga records to open.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { waitForFacilityHydration } from "../e2e/fixtures/page-helpers";

const SETTLE_TIMEOUT_MS = 20_000;
/** Sheet transitions run 300 ms; debounced previews start shortly after. */
const SETTLE_PAUSE_MS = 400;
const OPEN_TIMEOUT_MS = 30_000;
const DEFAULT_FACILITY_CODE = "FAC-MAFINGA";
const QUICK_ADD_OPTION_TIMEOUT_MS = 8_000;

export interface SeededBin {
  id: string;
  code: string;
  name: string;
  type: "feedstock_bin" | "biochar_bin" | "product_bin";
  stockMode: string;
}

export interface CaptureContext {
  facility: { id: string; code: string; name: string };
  firstCode: Record<string, string | undefined>;
  supplier?: { id: string; code: string; name: string };
  customer?: { id: string; code: string; name: string };
  bins: SeededBin[];
  counts: Record<string, number>;
}

async function one<T>(pool: Pool, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await pool.query(sql, params);
  return result.rows[0] as T | undefined;
}

/** Reads the seeded facility and the first record of each entity to open. */
export async function loadCaptureContext(): Promise<CaptureContext> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const facility = await one<{ id: string; code: string; name: string }>(
      pool,
      "select id, code, name from facilities where organization_id = $1 and archived_at is null order by (code = $2) desc, created_at limit 1",
      [DEC_ORG_ID, process.env.FORM_CAPTURE_FACILITY ?? DEFAULT_FACILITY_CODE],
    );
    if (!facility) throw new Error("No facility in the default organization. Run pnpm db:seed first.");
    const codeQueries: Record<string, string> = {
      feedstock: "select code from feedstocks where organization_id = $1 and facility_id = $2 order by code desc limit 1",
      productionRun: "select code from production_runs where organization_id = $1 and facility_id = $2 order by code desc limit 1",
      product: "select code from biochar_products where organization_id = $1 and facility_id = $2 order by code desc limit 1",
      order: "select code from orders where organization_id = $1 and facility_id = $2 order by code desc limit 1",
      delivery: "select d.code from deliveries d join orders o on o.id = d.order_id where d.organization_id = $1 and o.facility_id = $2 order by d.code desc limit 1",
      application: "select a.code from applications a where a.organization_id = $1 order by a.code desc limit 1",
      creditBatch: "select code from credit_batches where organization_id = $1 and facility_id = $2 order by code desc limit 1",
      sample: "select sample_code as code from samples where organization_id = $1 order by sample_code desc limit 1",
      formulation: "select code from formulations where organization_id = $1 order by code limit 1",
      feedstockType: "select code from feedstock_types where organization_id = $1 order by code limit 1",
      reactor: "select code from reactors where organization_id = $1 and facility_id = $2 order by code limit 1",
    };
    const firstCode: Record<string, string | undefined> = {};
    for (const [key, sql] of Object.entries(codeQueries)) {
      const params = sql.includes("$2") ? [DEC_ORG_ID, facility.id] : [DEC_ORG_ID];
      firstCode[key] = (await one<{ code: string }>(pool, sql, params).catch(() => undefined))?.code;
    }
    const supplier = await one<{ id: string; code: string; name: string }>(pool, "select id, code, name from suppliers where organization_id = $1 order by code limit 1", [DEC_ORG_ID]);
    const customer = await one<{ id: string; code: string; name: string }>(pool, "select id, code, name from customers where organization_id = $1 order by code limit 1", [DEC_ORG_ID]);
    const bins = (
      await pool.query(
        "select id, code, name, type, stock_mode as \"stockMode\" from storage_locations where organization_id = $1 and facility_id = $2 and archived_at is null order by code",
        [DEC_ORG_ID, facility.id],
      )
    ).rows as SeededBin[];
    const counts: Record<string, number> = {};
    for (const table of ["certifier_removals", "certifier_ghg_statements", "applications", "invitations"]) {
      const row = await one<{ n: string }>(pool, `select count(*) as n from ${table} where organization_id = $1`, [DEC_ORG_ID]).catch(() => undefined);
      counts[table] = Number(row?.n ?? 0);
    }
    return { facility, firstCode, supplier, customer, bins, counts };
  } finally {
    await pool.end();
  }
}

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
