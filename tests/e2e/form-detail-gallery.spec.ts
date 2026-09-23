/** Repeatable, local-only PR gallery. Run serially with the isolated 3102 environment. */
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { Page, Locator } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { test, expect, selectEntity, waitForFacilityHydration } from "./fixtures";
import { seedDurabilityBatch, seedCreditBatch } from "./fixtures/seed-chain-data";
import { createDbConnection } from "./fixtures/db";
import { seedOutputStockBrowserFixture, readOutputStockBrowserFixture, FIFO_BROWSER_DATE } from "./helpers/output-stock-browser-fixture";
import { createApplication } from "../../src/data-access/applications";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";

const OUTPUT = path.resolve("docs/archive/qa/2026-09-22-form-detail-e");
const VIEWPORTS = [{ width: 1440, height: 1100 }, { width: 390, height: 844 }];
const CAPTURE_TIMEOUT = 600_000;
const ACTION_TIMEOUT = 25_000;
const DATE = "2026-09-14";

if (process.env.CAPTURE_FORM_DETAIL_GALLERY === "1" && process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:3102") {
  throw new Error("Gallery capture requires the isolated local server on port 3102.");
}
test.skip(process.env.CAPTURE_FORM_DETAIL_GALLERY !== "1", "Opt-in local screenshot capture only.");
type StockFixture = Awaited<ReturnType<typeof seedOutputStockBrowserFixture>>;

test.beforeEach(async ({ adminPage: page }) => {
  test.setTimeout(CAPTURE_TIMEOUT);
  page.setDefaultTimeout(ACTION_TIMEOUT);
  expect(process.env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3102");
  await mkdir(OUTPUT, { recursive: true });
  const devTools = page.getByRole("button", { name: "Open Next.js Dev Tools", exact: true });
  if (await devTools.isVisible()) {
    await devTools.click();
    await page.locator("[data-preferences]").click();
    await page.locator("[data-hide-dev-tools]").click();
  }
  // All browser traffic stays local; external maps/fonts are not needed for this gallery.
  await page.context().route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost" && url.port === "3102" ? route.continue() : route.abort();
  });
});

async function settled(page: Page) {
  await expect(page.getByText(/^(Refreshing stock preview|Loading batch breakdown|Loading stock history)/)).toHaveCount(0);
  await expect(page.locator('[role="dialog"] [aria-busy="true"]:visible, [role="dialog"] .animate-pulse:visible')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350); // Let sheet transitions and debounced previews settle.
}
async function capture(page: Page, name: string) {
  await settled(page);
  for (const notification of await page.getByRole("button", { name: "Dismiss notification", exact: true }).all()) await notification.click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(OUTPUT, `${name}.png`), animations: "disabled" });
  await appendFile(path.join(OUTPUT, "captures.jsonl"), JSON.stringify({ name, viewport: page.viewportSize(), url: new URL(page.url()).pathname }) + "\n");
}
async function scrollTop(sheet: Locator) {
  await sheet.evaluate(el => { for (const node of [el, ...el.querySelectorAll("*")]) { if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) node.scrollTop = 0; } });
}
async function focusSection(target: Locator) {
  await target.evaluate(el => {
    let parent = el.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    if (parent) parent.scrollTop += el.getBoundingClientRect().top - parent.getBoundingClientRect().top - 24;
    else el.scrollIntoView({ block: "center" });
  });
}
async function pairs(page: Page, name: string, sectionNames: string[], dialogName?: string) {
  const sheet = dialogName ? page.getByRole("dialog", { name: dialogName, exact: true }) : page.getByRole("dialog").last();
  const values = () => sheet.locator("input:not([type=radio]), textarea, select").evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
  await page.waitForTimeout(500); // Allow debounced preview requests to start before recording button state.
  await settled(page);
  const initialValues = await values();
  const save = sheet.getByRole("button", { name: /^(Save changes|Save correction|Create Delivery|Create Application)$/ }).last();
  const initialDisabled = await save.count() ? await save.isDisabled() : null;
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await sheet.getByRole("radio", { name: "Simple", exact: true }).locator("..").click();
    await expect(sheet.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    // Correction history is saved audit data; only the replacement form follows the switch.
    const simpleScope = name === "output-stock-correction" ? sheet.locator("form").last() : sheet;
    await expect(simpleScope.getByText(/^(Wet feedstock|Dry feedstock)(:|$)/).filter({ visible: true })).toHaveCount(0);
    await expect(simpleScope.getByText(/^(Recorded wet stock|Recorded wet mass.*dry|Wet:.*Dry:|Total wet input|Remaining wet mass)/).filter({ visible: true })).toHaveCount(0);
    await expect(simpleScope.getByRole("button", { name: "More info", exact: true })).toHaveCount(0);
    await expect(simpleScope.getByRole("button", { name: /^Show calculation for/ })).toHaveCount(0);
    await scrollTop(sheet);
    const heading = sheet.getByRole("heading", { name: sectionNames[0], exact: true }).first();
    if (await heading.isVisible()) await focusSection(heading);
    await capture(page, `${name}-${viewport.width}-simple`);
    await sheet.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await settled(page);
    const disclosures = sheet.getByRole("button", { name: /^(Show|Hide) calculation for/ });
    // Close cards left open by the preceding viewport before documenting the default state.
    for (const button of await disclosures.all()) {
      if (await button.getAttribute("aria-expanded") === "true") await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
    const first = disclosures.first();
    if (await first.count()) {
      await focusSection(first.locator("xpath=ancestor::section[1]"));
      const ledger = first.locator("xpath=ancestor::section[1]").getByRole("columnheader", { name: "Component", exact: true });
      // Transport and application context cards deliberately have no invented mass split.
      if (await ledger.count()) {
        await expect(ledger).toBeVisible();
        const card = first.locator("xpath=ancestor::section[1]");
        await expect(card.getByRole("columnheader", { name: "% of total", exact: true })).toBeVisible();
        const bars = card.locator('table tbody [aria-hidden="true"]');
        for (const bar of await bars.all()) expect(await bar.evaluate(el => el.getBoundingClientRect().height)).toBe(4);
      }
    } else if (await heading.isVisible()) await focusSection(heading);
    await capture(page, `${name}-${viewport.width}-detailed`);
    if (await first.count()) {
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(first).toHaveAttribute("aria-expanded", "true");
      const controlled = await first.getAttribute("aria-controls");
      await expect(page.locator(`[id="${controlled}"]`)).toBeVisible();
      await focusSection(first.locator("xpath=ancestor::section[1]"));
      await capture(page, `${name}-${viewport.width}-details`);
      await first.focus();
      await page.keyboard.press("Space");
      await expect(first).toHaveAttribute("aria-expanded", "false");
    }
    if (name === "production-run-create" || name === "output-stock-correction") {
      const extra = name === "production-run-create"
        ? sheet.getByRole("button", { name: /^(Show|Hide) calculation for process flow$/ })
        : disclosures.last();
      await extra.click();
      await expect(extra).toHaveAttribute("aria-expanded", "true");
      await focusSection(extra.locator("xpath=ancestor::section[1]"));
      await capture(page, `${name}-${viewport.width}-additional-details`);
      await extra.click();
    }
    expect(await values()).toEqual(initialValues);
    if (initialDisabled !== null) expect(await save.isDisabled()).toBe(initialDisabled);
    expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize(VIEWPORTS[0]);
}
async function navigate(page: Page, route: string, facility: { id: string; name: string }) {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`/${route}?facility=${facility.id}`);
  await waitForFacilityHydration(page, facility.name);
}
async function openRow(page: Page, code: string) {
  await page.locator("table tbody tr", { hasText: code }).first().click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
}
async function edit(page: Page, entity: string) {
  await page.getByRole("button", { name: `Edit ${entity}`, exact: true }).click();
  await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
}
async function bin(page: Page, f: StockFixture) {
  await navigate(page, "storage-locations", f.facility);
  await page.getByPlaceholder("Search by code or name…").fill(f.bin.code);
  await page.getByText(f.bin.name, { exact: true }).first().click();
}
async function fillStock(page: Page, wet: string, reason: string) {
  await page.locator("#physicalDate").fill(FIFO_BROWSER_DATE);
  await page.locator("#stock-wet").fill(wet);
  await page.locator("#stock-moisture").fill("30");
  await page.locator("#stock-reason").fill(reason);
}

test("gallery delivery and application create read edit", async ({ adminPage: page, testUsers }) => {
  const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
  await navigate(page, "deliveries", f.facility);
  await page.getByRole("button", { name: "New Delivery", exact: true }).click();
  await page.locator("#deliveryDate").fill(DATE);
  await selectEntity(page, "Order", f.order.id, f.order.code);
  await page.locator("#storageLocationId").selectOption(f.bin.id);
  await page.locator("#deliveredWetMassKg").fill("2500");
  await page.locator("#moistureContentPercent").fill("15");
  // The blocker renders once, under the wet-mass field, never a second time inside the preview.
  await expect(page.getByText(/Not enough dry biochar/)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create Delivery", exact: true })).toBeDisabled();
  await capture(page, "delivery-create-1440-simple-blocker");
  await page.locator("#deliveredWetMassKg").fill("2000");
  await page.locator("#moistureContentPercent").fill("30");
  await page.locator("#distanceKmOverride").fill("25");
  await page.locator("#distanceKmOverride").blur();
  await pairs(page, "delivery-create", ["Mass and moisture", "Transport"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.locator("#deliveredWetMassKg")).toHaveValue("2000");
  await page.getByRole("button", { name: "Create Delivery", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const delivery = (await readOutputStockBrowserFixture(f)).deliveries[0];
  await openRow(page, delivery.code);
  await pairs(page, "delivery-read", ["Mass and moisture"]);
  await edit(page, "Delivery");
  await pairs(page, "delivery-edit", ["Mass and moisture"]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toHaveCount(0);
  await navigate(page, "applications", f.facility);
  await page.getByRole("button", { name: "New Application", exact: true }).click();
  await page.locator("#applicationDate").fill(DATE);
  await page.locator("#deliveryId").selectOption(delivery.id);
  await page.locator("#biocharAppliedTons").fill("1000");
  await page.locator("#fieldSizeHa").fill("1");
  await page.locator("#fieldIdentifier").fill("E2E Demonstration plot A");
  await page.locator("#cropType").fill("Maize");
  await pairs(page, "application-create", ["Application details", "Field details"]);
  await page.getByRole("button", { name: "Create Application", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const application = (await readOutputStockBrowserFixture(f)).applications[0];
  await openRow(page, application.code);
  await pairs(page, "application-read", ["Application details", "Field details"]);
  await edit(page, "Application");
  await pairs(page, "application-edit", ["Application details", "Field details"]);
});

test("gallery feedstock create read edit", async ({ adminPage: page, seededData: d }) => {
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.transportLegs).values({ organizationId: DEC_ORG_ID, entityType: "feedstock", entityId: d.feedstock.id, originName: "E2E Wood-chip supplier", destinationName: d.facility.name, distanceKm: 42, distanceSource: "manual", transportMethodType: "road", loadMassKg: 1500, tripType: "return", isDerived: true });
    await db.update(schema.feedstocks).set({ massWetKg: 1500, massDryKg: 1200, moistureContentPercent: 20, vehicleId: d.vehicle.id, notes: "E2E wood chips received, weighed and allocated to the covered feedstock bin." }).where(eq(schema.feedstocks.id, d.feedstock.id));
  } finally { await pool.end(); }
  await navigate(page, "feedstocks", d.facility);
  await page.getByRole("button", { name: "New Feedstock", exact: true }).click();
  await page.locator("#deliveryDate").fill(DATE);
  await selectEntity(page, "Supplier", d.supplier.id, d.supplier.name);
  await selectEntity(page, "Vehicle", d.vehicle.id, d.vehicle.name);
  await selectEntity(page, "Feedstock type", d.feedstockType.id, d.feedstockType.name);
  await page.locator("#totalWetMassKg").fill("1500");
  await page.locator("#moisturePercent").fill("20");
  await selectEntity(page, "Storage bin", d.feedstockStorageLocation.id, d.feedstockStorageLocation.name);
  await page.locator('input[name="allocations.0.allocatedWetMassKg"]').fill("1500");
  await page.locator("#notes").fill("E2E wood chips received, weighed and allocated to covered storage.");
  await pairs(page, "feedstock-create", ["Material", "Bin allocations"]);
  await navigate(page, "feedstocks", d.facility);
  await openRow(page, d.feedstock.code);
  await pairs(page, "feedstock-read", ["Material"]);
  await edit(page, "Feedstock");
  await pairs(page, "feedstock-edit", ["Material", "Bin allocations"]);
});

test("gallery production run create read edit credit batch and sample read", async ({ adminPage: page, seededData: d }) => {
  const batch = await seedDurabilityBatch(d.facility.id, d.reactor.id, d.feedstockType.id, "GALLERY-" + crypto.randomUUID().slice(0, 6));
  const { db, pool } = createDbConnection();
  try {
    await db.update(schema.feedstocks).set({ massWetKg: 12000, massDryKg: 9600, moistureContentPercent: 20 }).where(eq(schema.feedstocks.id, d.feedstock.id));
    await db.insert(schema.productionRunFeedstockDraws).values(batch.runIds.map(productionRunId => ({ organizationId: DEC_ORG_ID, productionRunId, storageLocationId: d.feedstockStorageLocation.id, wetMassKg: 4000 })));
    await db.insert(schema.productionRunFeedstocks).values(batch.runIds.map(productionRunId => ({ organizationId: DEC_ORG_ID, productionRunId, feedstockId: d.feedstock.id, wetMassUsedKg: 4000 })));
    await db.update(schema.productionRuns).set({ status: "complete", feedstockWetMassKg: 4000, feedstockMassDryKg: 3200, feedstockMoisturePercent: 20, biocharOutputKg: 1250, biocharMoisturePercent: 20, biocharDryMassKg: 1000, biocharStorageLocationId: d.biocharStorageLocation.id, feedingRateKgHr: 650, residenceTimeMinutes: 35, dieselOperationLiters: 8, dieselGensetLiters: 3, preprocessingFuelLiters: 2, electricityKwh: 42 }).where(inArray(schema.productionRuns.id, batch.runIds));
    await db.update(schema.samples).set({ labName: "E2E Carbon Laboratory", labAccreditation: "E2E demonstration accreditation", analysisDate: "2026-09-21", totalHydrogenPercent: 2.5, totalNitrogenPercent: 0.8, totalOxygenPercent: 8, totalSulfurPercent: 0.1, inorganicCarbonPercent: 2, saltContentGPerKg: 1.2, weightGrams: 250, volumeMl: 500, moistureContentPercent: 5, ashContentPercent: 12, bulkDensityKgPerM3: 400, ph: 8.2 }).where(eq(schema.samples.sampleCode, batch.sampleCodes[0]));
    const [sample] = await db.select().from(schema.samples).where(eq(schema.samples.sampleCode, batch.sampleCodes[0]));
    await db.insert(schema.transportLegs).values([
      { organizationId: DEC_ORG_ID, entityType: "sample", entityId: sample.id, originName: "E2E Production facility", destinationName: "E2E Regional collection hub", distanceKm: 42, distanceSource: "manual", transportMethodType: "road", vehicleType: "Light goods vehicle", loadMassKg: 2, tripType: "return" },
      { organizationId: DEC_ORG_ID, entityType: "sample", entityId: sample.id, originName: "E2E Regional collection hub", destinationName: "E2E Carbon Laboratory", distanceKm: 180, distanceSource: "manual", transportMethodType: "road", vehicleType: "Heavy goods vehicle", loadMassKg: 2, tripType: "one_way" },
    ]);
  } finally { await pool.end(); }
  await navigate(page, "production-runs", d.facility);
  await page.getByRole("button", { name: "New Production Run", exact: true }).click();
  await selectEntity(page, "Reactor", d.reactor.id, d.reactor.identifier);
  await page.locator("#startDate").fill(DATE);
  await page.locator("#startTime").fill("08:00");
  await page.locator("#endDate").fill(DATE);
  await page.locator("#endTime").fill("14:00");
  if (await page.locator('input[name="feedstockDraws.0.wetMassKg"]').count() === 0) await page.getByRole("button", { name: "Add source", exact: true }).click();
  await selectEntity(page, "Source bin", d.feedstockStorageLocation.id, d.feedstockStorageLocation.name);
  await page.locator('input[name="feedstockDraws.0.wetMassKg"]').fill("100");
  await page.locator("#feedstockMoisturePercent").fill("20");
  await page.locator("#feedingRateKgHr").fill("16");
  await page.locator("#residenceTimeMinutes").fill("35");
  await selectEntity(page, "Biochar storage bin", d.biocharStorageLocation.id, d.biocharStorageLocation.name);
  await page.locator('input[name="biocharOutputKg"]').fill("25");
  await page.locator('input[name="biocharMoisturePercent"]').fill("10");
  await page.locator("#electricityKwh").fill("42");
  await pairs(page, "production-run-create", ["Feedstock & processing", "Output", "Energy"]);
  await navigate(page, "production-runs", d.facility);
  await openRow(page, batch.creditBatchCode + "-PR1");
  await pairs(page, "production-run-read", ["Feedstock & processing", "Output"]);
  await edit(page, "Production Run");
  await pairs(page, "production-run-edit", ["Feedstock & processing", "Output", "Energy"]);
  await navigate(page, "credit-batches", d.facility);
  await page.getByText(batch.creditBatchCode, { exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await pairs(page, "credit-batch-read", ["Production runs", "Batch definition"]);
  await navigate(page, "samples", d.facility);
  await openRow(page, batch.sampleCodes[0]);
  await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeVisible();
  await pairs(page, "sample-read", ["Transport"]);
});

test("gallery output bin reconciliation loss and correction", async ({ adminPage: page, testUsers }) => {
  const f = await seedOutputStockBrowserFixture(testUsers.admin.id, true);
  await bin(page, f);
  await page.getByRole("button", { name: "Reconcile stock", exact: true }).click();
  await fillStock(page, "600", "E2E stock count: drying only, no dry biochar loss.");
  await pairs(page, "output-bin-reconciliation", ["Stock preview", "Reason"]);
  await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bin(page, f);
  await page.getByRole("button", { name: "Record loss", exact: true }).click();
  await fillStock(page, "120", "E2E spill during loading.");
  await pairs(page, "output-bin-loss", ["Stock preview", "Reason"]);
  await page.getByRole("button", { name: "Record loss", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bin(page, f);
  await page.getByRole("button", { name: "More info", exact: true }).first().click();
  const history = page.getByRole("dialog", { name: "Stock history", exact: true });
  await history.locator("article").filter({ hasText: "E2E spill during loading." }).getByRole("button", { name: "Correct entry" }).click();
  await fillStock(page, "12", "E2E corrected spill after scale ticket review.");
  await pairs(page, "output-stock-correction", ["Proposed replacement", "Stock preview"], "Stock history");
  await history.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(history.getByText("E2E corrected spill after scale ticket review.", { exact: true }).first()).toBeVisible();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await scrollTop(history);
    await capture(page, `output-stock-correction-saved-${viewport.width}-history`);
  }
});


test("gallery credit batch applied mass context", async ({ adminPage: page, testUsers }) => {
  const f = await seedOutputStockBrowserFixture(testUsers.admin.id, true);
  const { db, pool } = createDbConnection();
  let batch: { id: string; code: string };
  try {
    await db.update(schema.facilities).set({ durabilityOption: "200_year" }).where(eq(schema.facilities.id, f.facility.id));
    const [material] = await db.insert(schema.feedstockTypes).values({ organizationId: DEC_ORG_ID, code: `E2E-GALLERY-WOOD-${f.tag}`, name: `E2E Gallery wood chips ${f.tag}`, category: "forestry", usage: "pyrolysis" }).returning();
    batch = await seedCreditBatch(f.facility.id, `GALLERY-APPLIED-${f.tag}`, material.id);
    await db.update(schema.creditBatches).set({ startDate: "2026-09-01", endDate: "2026-09-30" }).where(eq(schema.creditBatches.id, batch.id));
    await db.insert(schema.creditBatchProductionRuns).values(f.runs.map(run => ({ organizationId: DEC_ORG_ID, creditBatchId: batch.id, productionRunId: run.id })));
    await db.insert(schema.samples).values([0, 1, 2].map(index => ({ organizationId: DEC_ORG_ID, sampleCode: `E2E-APPLIED-S${index}-${f.tag}`, creditBatchId: batch.id, productionRunId: f.runs[index % 2].id, samplingTime: new Date("2026-09-12T12:00:00Z"), totalCarbonPercent: 80, organicCarbonPercent: 78, hToCOrgRatio: 0.38, oToCOrgRatio: 0.12 })));
  } finally { await pool.end(); }
  await createApplication(f.ctx, { code: `E2E-APPLIED-${f.tag}`, deliveryId: f.delivery!.id, applicationDate: new Date(DATE), biocharAppliedTons: 1, fieldSizeHa: 1, fieldIdentifier: "E2E Soil plot A", cropType: "Maize", gpsLatitude: -6.8, gpsLongitude: 39.2, applicationMethodType: "mechanical", soilTemperatureSource: "baseline", soilTemperatureC: 25 });
  await navigate(page, "credit-batches", f.facility);
  await page.getByText(batch.code, { exact: true }).first().click();
  await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
  await pairs(page, "credit-batch-applied-read", ["Production runs", "Batch definition"]);
});
