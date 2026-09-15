import type { Page, Request } from "@playwright/test";

import { expect, test, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

const FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR =
  'input[name="feedstockDraws.0.wetMassKg"]';
const TRANSPORT_WRITE_TIMEOUT_MS = 20_000;
const UUID_PATH_SEGMENT_RE =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

async function createProductionRun(page: Page, seededData: SeededChainData) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await expect(
    page.getByRole("button", { name: "New Production Run" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Production Run" }).click();
  await waitForSideSheet(page);

  await page.selectOption('select[name="status"]', "draft");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  await page.fill('input[name="startDate"]', new Date().toISOString().split("T")[0]);
  await selectEntity(
    page,
    "Source Bin",
    seededData.feedstockStorageLocation.id,
    seededData.feedstockStorageLocation.name,
  );
  await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, "50");
  await page.fill('input[name="feedstockMoisturePercent"]', "15");
  await selectEntity(
    page,
    "Biochar Storage",
    seededData.biocharStorageLocation.id,
    seededData.biocharStorageLocation.name,
  );
  await page.fill('input[name="biocharOutputKg"]', "10");
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Create Production Run" })
    .click();
  await waitForSideSheetClose(page);
  await expect(page.getByRole("status")).toHaveText("Production run created.");
}

test("independent reads overlap without holding a Production Run write", async ({
  adminPage: page,
  seededData,
}, testInfo) => {
  let releaseStats!: () => void;
  let markStatsStarted!: () => void;
  const statsStarted = new Promise<void>((resolve) => {
    markStatsStarted = resolve;
  });
  const heldStats = new Promise<void>((resolve) => {
    releaseStats = resolve;
  });
  const inFlightReads = new Set<Request>();
  const readStarts = new Map<Request, number>();
  const readTimings: Array<{
    route: string;
    relativeStartMs: number;
    durationMs: number;
  }> = [];
  let firstReadStartedAt: number | undefined;
  let maxConcurrentReads = 0;
  const trackReadStart = (request: Request) => {
    if (!request.url().includes("/api/reads/")) return;
    const startedAt = Date.now();
    firstReadStartedAt ??= startedAt;
    readStarts.set(request, startedAt);
    inFlightReads.add(request);
    maxConcurrentReads = Math.max(maxConcurrentReads, inFlightReads.size);
  };
  const trackReadEnd = (request: Request) => {
    const startedAt = readStarts.get(request);
    if (startedAt !== undefined && firstReadStartedAt !== undefined) {
      readTimings.push({
        route: new URL(request.url()).pathname.replace(
          UUID_PATH_SEGMENT_RE,
          "/:id",
        ),
        relativeStartMs: startedAt - firstReadStartedAt,
        durationMs: Date.now() - startedAt,
      });
    }
    inFlightReads.delete(request);
  };
  page.on("request", trackReadStart);
  page.on("requestfinished", trackReadEnd);
  page.on("requestfailed", trackReadEnd);

  await page.route("**/api/reads/production-runs/stats*", async (route) => {
    markStatsStarted();
    await heldStats;
    await route.continue();
  });

  try {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await statsStarted;

    // A held HTTP read remains in flight while the create mutation travels
    // through the separate Server Action write transport.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        createProductionRun(page, seededData),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Production Run write waited on an unrelated read.")),
            TRANSPORT_WRITE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    expect(maxConcurrentReads).toBeGreaterThanOrEqual(2);
    releaseStats();
    await expect.poll(() => inFlightReads.size).toBe(0);
    const measurement = { maxConcurrentReads, requests: readTimings };
    await testInfo.attach("read-transport-timings.json", {
      body: JSON.stringify(measurement, null, 2),
      contentType: "application/json",
    });
    console.info("[read-transport-measurement]", JSON.stringify(measurement));
  } finally {
    releaseStats();
    page.off("request", trackReadStart);
    page.off("requestfinished", trackReadEnd);
    page.off("requestfailed", trackReadEnd);
  }
});
