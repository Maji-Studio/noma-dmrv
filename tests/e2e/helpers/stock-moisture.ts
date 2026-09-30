import { expect, type Page } from "@playwright/test";

/** The single moisture field each stock form shows when its bin does not split the draw. */
const SINGLE_FIELD = {
  delivery: "#moistureContentPercent",
  stock: "#stock-moisture",
  "product-source": "#moistureContentPercent",
} as const;

/** A load that reaches more sub-bins than this is not something a spec builds. */
const MAX_ROW_PASSES = 6;

/**
 * Enter the moisture of an output-bin draw. A split bin shows one required
 * reading per sub-bin the load reaches: every row shown is set to `value`,
 * then any row a reading reveals, until none is left empty. A bin that does
 * not split (a mix bin, or one with nothing in it yet) keeps one field.
 * Enter the wet mass first: it decides which rows appear.
 */
export async function fillStockMoisture(page: Page, form: keyof typeof SINGLE_FIELD, value: string) {
  const single = page.locator(SINGLE_FIELD[form]);
  const rows = page.locator(`input[id^="${form}-moisture-"]`);
  await expect(single.or(rows.first())).toBeVisible();
  if (await single.isVisible()) {
    await single.fill(value);
    return;
  }
  for (let pass = 0; pass < MAX_ROW_PASSES; pass++) {
    let filled = 0;
    for (const row of await rows.all()) {
      if (pass > 0 && (await row.inputValue()) !== "") continue;
      await row.fill(value);
      filled++;
    }
    if (filled === 0) return;
  }
}
