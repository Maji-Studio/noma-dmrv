/**
 * Scope of this spec: it proves that the browser dispatches the migrated reads
 * in parallel, which is exactly what the Server Function queue prevented. It
 * deliberately proves nothing about server-side execution: holding a read in
 * Playwright's network layer stops it before it ever reaches a Route Handler,
 * so an assertion built on that would measure Playwright, not the app. Server
 * execution and connection-pool behaviour are measured separately.
 */
import type { Request } from "@playwright/test";

import { expect, test } from "./fixtures";

const READ_PATH = "/api/reads/";
const MIN_PARALLEL_READS = 2;
const UUID_PATH_SEGMENT_RE =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

test("authenticated reads leave the browser in parallel", async ({
  adminPage: page,
  seededData,
}, testInfo) => {
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
    if (!request.url().includes(READ_PATH)) return;
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

  try {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await expect(
      page.getByRole("button", { name: "New Production Run" }),
    ).toBeVisible();
    await expect.poll(() => inFlightReads.size).toBe(0);

    expect(readTimings.length).toBeGreaterThanOrEqual(MIN_PARALLEL_READS);
    // Server Actions would have serialized these; the HTTP transport does not.
    expect(maxConcurrentReads).toBeGreaterThanOrEqual(MIN_PARALLEL_READS);

    const measurement = { maxConcurrentReads, requests: readTimings };
    await testInfo.attach("read-transport-timings.json", {
      body: JSON.stringify(measurement, null, 2),
      contentType: "application/json",
    });
    console.info("[read-transport-measurement]", JSON.stringify(measurement));
  } finally {
    page.off("request", trackReadStart);
    page.off("requestfinished", trackReadEnd);
    page.off("requestfailed", trackReadEnd);
  }
});
