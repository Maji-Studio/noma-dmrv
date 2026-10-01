import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { outputStockAllocations } from "../../src/db/schema";
import { test, expect, selectEntity, waitForFacilityHydration } from "./fixtures";
import { FIFO_BROWSER_TIME, readOutputStockBrowserFixture, seedOutputStockBrowserFixture } from "./helpers/output-stock-browser-fixture";

const FLOW_TIMEOUT_MS = 180_000;

test.describe("Split bin picker", () => {
  test.setTimeout(FLOW_TIMEOUT_MS);

  test("ticks, reorders and reads sub-bins from the keyboard and saves the operator's order", async ({ adminPage: page, testUsers }) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    const [older, newer] = f.products;
    await page.goto(`/deliveries?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New delivery", exact: true }).click();
    await page.locator("#deliveryDate").fill(FIFO_BROWSER_TIME);
    await selectEntity(page, "Order", f.order.id, f.order.code);
    await page.locator("#storageLocationId").selectOption(f.bin.id);
    await page.locator("#deliveredWetMassKg").fill("1200");
    // Oldest first: 1,200 kg wet stays inside the older batch, so one row.
    const reading = (code: string) => page.getByRole("spinbutton", { name: `${code} moisture` });
    await expect(reading(older.code)).toBeVisible();
    await expect(reading(newer.code)).toHaveCount(0);

    // Change, from the keyboard only: move the newer batch up, then apply.
    await page.getByRole("button", { name: "Change the sub-bins in this load" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Sub-bins in this load" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `Move ${newer.code} up` }).focus();
    await page.keyboard.press("Enter");
    // At the top its up arrow is disabled, so focus stays on the row, on its down arrow.
    await expect(dialog.getByRole("button", { name: `Move ${newer.code} down` })).toBeFocused();
    // Untick and tick again with Space; focus follows the row between the lists.
    const olderBox = dialog.getByRole("checkbox", { name: new RegExp(older.code) });
    await olderBox.focus();
    await page.keyboard.press("Space");
    await expect(olderBox).not.toBeChecked();
    await expect(olderBox).toBeFocused();
    await page.keyboard.press("Space");
    await expect(olderBox).toBeChecked();
    await dialog.getByRole("button", { name: "Use this order" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`${newer.code} → ${older.code}`, { exact: true })).toBeVisible();

    // The newer batch holds 720 kg solids, 1,000 kg wet at 28%: 1,200 kg reaches the older one too.
    await reading(newer.code).focus();
    await page.keyboard.type("28");
    await expect(reading(older.code)).toBeVisible();
    await reading(older.code).focus();
    await page.keyboard.type("25");
    const create = page.getByRole("button", { name: "Create delivery", exact: true });
    // The preview refetches for the new readings; Create waits for it.
    await expect(create).toBeEnabled();
    await create.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [delivery] = (await readOutputStockBrowserFixture(f)).deliveries;
    const rows = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    const byProduct = new Map(rows.map(row => [row.biocharProductId, row]));
    // 1,000 kg wet empties the newer batch at 28%; the other 200 kg wet at 25% is 150 kg solids from the older one.
    expect(byProduct.get(newer.id)).toMatchObject({ wetMassKg: "1000.000" });
    expect(byProduct.get(older.id)).toMatchObject({ wetMassKg: "200.000" });
    expect(byProduct.get(older.id)?.basisSnapshot).toMatchObject({ policy: "operator_order", order: [newer.id, older.id], readingPercent: "25" });
  });

  test("shows each sub-bin on the bin sheet, wet first, with its details a tap away", async ({ adminPage: page, testUsers }) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await page.goto(`/storage-locations?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByPlaceholder("Search by code or name…").fill(f.bin.code);
    await page.getByText(f.bin.name, { exact: true }).first().click();
    const cards = page.getByRole("dialog").getByRole("list", { name: "Sub-bins, oldest first" }).getByRole("listitem");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText(f.products[0].code);
    await expect(cards.first()).toContainText("≈ 1,500 kg wet");
    // A tap opens it too, for touch screens with neither hover nor keyboard focus.
    await cards.first().getByRole("button", { name: `${f.products[0].code} details` }).click();
    await expect(page.getByText("Dry biochar", { exact: true })).toBeVisible();
    await expect(page.getByText("Added 1,500 kg wet", { exact: true })).toBeVisible();
  });
});
