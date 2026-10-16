import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "@/db/schema";
import { formatUtcDate } from "@/lib/date-utils";
import { feedstockFixtureValues } from "../helpers/feedstock-fixture";
import {
  test,
  expect,
  createTestStorageLocation,
  deleteTestStorageLocation,
  selectEntity,
  waitForFacilityHydration,
  type SeededChainData,
} from "./fixtures";
import {
  chainSeedRefs,
  seedCertifierMapping,
  seedUngroupedReadyBatchWithChain,
  type SeededReadyBatch,
} from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";

const COLD_COMPILE_TIMEOUT_MS = 30_000;
const FEEDSTOCK_WET_MASS_KG = 1_000;
const FEEDSTOCK_MOISTURE_PERCENT = 0;
const EXPECTED_BATCH_COUNT = 2;
const MS_PER_HOUR = 60 * 60 * 1_000;
const PRODUCTION_MONTHS_AGO = 1;
const PRODUCTION_DAY_OF_MONTH = 15;
const FIRST_RUN_START_HOUR_UTC = 8;
const RUN_START_SPACING_HOURS = 6;
const RUN_DURATION_HOURS = 4;
const DECLARED_FEEDSTOCK_ERROR =
  "The selected production runs are a different feedstock than the one chosen for this batch. " +
  "A credit batch contains one feedstock. Choose production runs that use the selected feedstock, " +
  "or change the batch's feedstock type.";

async function openBatchEditor(
  page: Page,
  data: SeededChainData,
  batch: SeededReadyBatch,
) {
  await page.goto(
    `/credit-batches?facility=${data.facility.id}&batch=${batch.creditBatchId}`,
  );
  await waitForFacilityHydration(page, data.facility.name);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit credit batch", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Update credit batch", exact: true }),
  ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
  return dialog;
}

test("concurrent same-month credit batches keep separate feedstock cohorts and refuse a mismatched declaration", async ({
  adminPage: page,
  seededData,
  cleanupTestData,
}) => {
  void cleanupTestData;
  const tag = randomUUID();
  const alternateTypeId = randomUUID();
  const mismatchedTypeId = randomUUID();
  const alternateFeedstockId = randomUUID();
  const seedTime = new Date();
  // Midway through the previous UTC month is always past, even when the
  // captured clock is on the first or last day of a month.
  const productionStart = new Date(Date.UTC(
    seedTime.getUTCFullYear(),
    seedTime.getUTCMonth() - PRODUCTION_MONTHS_AGO,
    PRODUCTION_DAY_OF_MONTH,
    FIRST_RUN_START_HOUR_UTC,
  ));
  const connection = createDbConnection();
  const cleanups: Array<() => Promise<void>> = [];

  try {
    const mapping = await seedCertifierMapping(seededData.facility.id, {
      externalProjectId: `e2e-concurrent-project-${tag}`,
      defaultRemovalTemplateId: `e2e-concurrent-template-${tag}`,
    });
    cleanups.push(mapping.cleanup);

    await connection.db.insert(schema.feedstockTypes).values([
      {
        organizationId: DEC_ORG_ID,
        id: alternateTypeId,
        code: `E2E-FST-B-${tag}`,
        name: `E2E Concurrent feedstock B ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      },
      {
        organizationId: DEC_ORG_ID,
        id: mismatchedTypeId,
        code: `E2E-FST-C-${tag}`,
        name: `E2E Mismatched feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      },
    ]);
    cleanups.push(async () => {
      await connection.db.delete(schema.feedstockTypes).where(and(
        eq(schema.feedstockTypes.organizationId, DEC_ORG_ID),
        inArray(schema.feedstockTypes.id, [alternateTypeId, mismatchedTypeId]),
      ));
    });

    const alternateInputBin = await createTestStorageLocation(seededData.facility.id, {
      code: `E2E-BIN-FS-B-${tag}`,
      name: `E2E Concurrent feedstock bin B ${tag}`,
      type: "feedstock_bin",
    });
    cleanups.push(() => deleteTestStorageLocation(alternateInputBin.id));
    const alternateOutputBin = await createTestStorageLocation(seededData.facility.id, {
      code: `E2E-BIN-BC-B-${tag}`,
      name: `E2E Concurrent biochar bin B ${tag}`,
      type: "biochar_bin",
    });
    cleanups.push(() => deleteTestStorageLocation(alternateOutputBin.id));
    await connection.db.update(schema.storageLocations).set({ feedstockTypeId: alternateTypeId }).where(and(
      eq(schema.storageLocations.organizationId, DEC_ORG_ID),
      eq(schema.storageLocations.id, alternateInputBin.id),
    ));
    await connection.db.insert(schema.feedstocks).values(await feedstockFixtureValues(connection.db, {
      organizationId: DEC_ORG_ID,
      id: alternateFeedstockId,
      facilityId: seededData.facility.id,
      supplierId: seededData.supplier.id,
      storageLocationId: alternateInputBin.id,
      feedstockTypeId: alternateTypeId,
      code: `E2E-FS-B-${tag}`,
      massWetKg: FEEDSTOCK_WET_MASS_KG,
      massDryKg: FEEDSTOCK_WET_MASS_KG,
      moistureContentPercent: FEEDSTOCK_MOISTURE_PERCENT,
    }));
    cleanups.push(async () => {
      await connection.db.delete(schema.feedstocks).where(and(
        eq(schema.feedstocks.organizationId, DEC_ORG_ID),
        eq(schema.feedstocks.id, alternateFeedstockId),
      ));
    });

    const first = await seedUngroupedReadyBatchWithChain(chainSeedRefs(seededData), `${tag}-A`);
    cleanups.push(first.cleanup);
    const second = await seedUngroupedReadyBatchWithChain({
      ...chainSeedRefs(seededData),
      feedstockId: alternateFeedstockId,
      feedstockStorageLocationId: alternateInputBin.id,
      biocharStorageLocationId: alternateOutputBin.id,
    }, `${tag}-B`);
    cleanups.push(second.cleanup);
    const batchIds = [first.creditBatchId, second.creditBatchId];

    const readMembership = () => connection.db.select({
      batchId: schema.creditBatchProductionRuns.creditBatchId,
      runId: schema.productionRuns.id,
      feedstockTypeId: schema.feedstocks.feedstockTypeId,
      startedAt: schema.productionRuns.startTime,
    }).from(schema.creditBatchProductionRuns)
      .innerJoin(schema.productionRuns, eq(schema.productionRuns.id, schema.creditBatchProductionRuns.productionRunId))
      .innerJoin(schema.productionRunFeedstocks, eq(schema.productionRunFeedstocks.productionRunId, schema.productionRuns.id))
      .innerJoin(schema.feedstocks, eq(schema.feedstocks.id, schema.productionRunFeedstocks.feedstockId))
      .where(and(
        eq(schema.creditBatchProductionRuns.organizationId, DEC_ORG_ID),
        inArray(schema.creditBatchProductionRuns.creditBatchId, batchIds),
      )).orderBy(schema.creditBatchProductionRuns.creditBatchId, schema.productionRuns.id);

    const seededMembership = await readMembership();
    expect(seededMembership).toHaveLength(EXPECTED_BATCH_COUNT);
    // Both chains share this test's reactor. Keep their windows separate;
    // each worker has its own fixture reactor, so these fixed times are safe.
    for (const [index, batchId] of batchIds.entries()) {
      const run = seededMembership.find((row) => row.batchId === batchId)!;
      const startTime = new Date(productionStart.getTime() + index * RUN_START_SPACING_HOURS * MS_PER_HOUR);
      const endTime = new Date(startTime.getTime() + RUN_DURATION_HOURS * MS_PER_HOUR);
      await connection.db.update(schema.productionRuns).set({ startTime, endTime }).where(and(
        eq(schema.productionRuns.organizationId, DEC_ORG_ID),
        eq(schema.productionRuns.id, run.runId),
      ));
    }
    const membership = await readMembership();
    expect(membership).toHaveLength(EXPECTED_BATCH_COUNT);
    const firstRun = membership.find((row) => row.batchId === first.creditBatchId)!;
    const secondRun = membership.find((row) => row.batchId === second.creditBatchId)!;
    expect(firstRun.feedstockTypeId).toBe(seededData.feedstockType.id);
    expect(secondRun.feedstockTypeId).toBe(alternateTypeId);
    expect(firstRun.runId).not.toBe(secondRun.runId);
    expect(firstRun.startedAt).not.toEqual(secondRun.startedAt);

    const productionDay = formatUtcDate(productionStart);
    for (const run of membership) {
      expect(formatUtcDate(run.startedAt!)).toBe(productionDay);
    }
    await connection.db.update(schema.creditBatches).set({
      startDate: productionDay,
      endDate: productionDay,
    }).where(and(
      eq(schema.creditBatches.organizationId, DEC_ORG_ID),
      inArray(schema.creditBatches.id, batchIds),
    ));
    const batches = await connection.db.select().from(schema.creditBatches).where(and(
      eq(schema.creditBatches.organizationId, DEC_ORG_ID),
      eq(schema.creditBatches.facilityId, seededData.facility.id),
    ));
    expect(batches).toHaveLength(EXPECTED_BATCH_COUNT);
    expect(new Set(batches.map((batch) => batch.id)).size).toBe(EXPECTED_BATCH_COUNT);
    expect(new Set(batches.map((batch) => batch.feedstockTypeId))).toEqual(
      new Set([seededData.feedstockType.id, alternateTypeId]),
    );
    expect(batches.every((batch) => batch.startDate === productionDay && batch.endDate === productionDay)).toBe(true);
    expect(batches.every((batch) => batch.removalTemplateId === `e2e-concurrent-template-${tag}`)).toBe(true);

    // Membership needs no registry connection. Remove this test's temporary
    // mapping before any browser read so even a local Organization with saved
    // credentials cannot fetch the fake template from the real registry.
    await mapping.cleanup();

    // Leave both completed runs unassigned so the first editor must separate
    // them by feedstock, and saving must resolve membership on the server.
    await connection.db.delete(schema.creditBatchProductionRuns).where(and(
      eq(schema.creditBatchProductionRuns.organizationId, DEC_ORG_ID),
      inArray(schema.creditBatchProductionRuns.creditBatchId, batchIds),
    ));
    expect(await readMembership()).toEqual([]);

    for (const [batch, ownRun, otherRun] of [
      [first, firstRun, secondRun],
      [second, secondRun, firstRun],
    ] as const) {
      const dialog = await openBatchEditor(page, seededData, batch);
      // Preview rows have no accessible role or run code; use the component's
      // existing identity attributes after entering through role-based controls.
      const previews = dialog.getByTestId("credit-batch-production-run-preview");
      await expect(previews).toHaveCount(1);
      await expect(previews).toHaveAttribute("data-production-run-id", ownRun.runId);
      await expect(dialog.locator(`[data-production-run-id="${otherRun.runId}"]`)).toHaveCount(0);
      // The editor starts without saved members. The server must attach the
      // matching unassigned run using the declared feedstock and window.
      await dialog.getByRole("button", { name: "Update credit batch", exact: true }).click();
      await expect(dialog).toBeHidden();
    }
    expect(await readMembership()).toEqual(membership);

    const [beforeRefusal] = await connection.db.select().from(schema.creditBatches).where(and(
      eq(schema.creditBatches.organizationId, DEC_ORG_ID),
      eq(schema.creditBatches.id, first.creditBatchId),
    ));
    const dialog = await openBatchEditor(page, seededData, first);
    let modifiedRequests = 0;
    // Exercise the real authenticated updateCreditBatchFn request. The UI
    // filters mismatched runs, so alter only the declared type on its outgoing
    // action; preserve its run, version, dates and the server's actual response.
    await page.route("**/credit-batches?**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) {
        await route.continue();
        return;
      }
      const args: unknown = request.postDataJSON();
      const input: unknown = Array.isArray(args) && args.length === 1 ? args[0] : null;
      if (typeof input !== "object" || input === null || !("creditBatchId" in input) || input.creditBatchId !== first.creditBatchId) {
        await route.continue();
        return;
      }
      const fields = input as Record<string, unknown>;
      expect(fields.productionRunIds).toEqual([firstRun.runId]);
      modifiedRequests += 1;
      fields.feedstockTypeId = mismatchedTypeId;
      await route.continue({ postData: JSON.stringify(args) });
    });
    await dialog.getByRole("button", { name: "Update credit batch", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(DECLARED_FEEDSTOCK_ERROR);
    expect(modifiedRequests).toBe(1);
    expect(await readMembership()).toEqual(membership);
    const [unchanged] = await connection.db.select().from(schema.creditBatches).where(and(
      eq(schema.creditBatches.organizationId, DEC_ORG_ID),
      eq(schema.creditBatches.id, first.creditBatchId),
    ));
    expect(unchanged.feedstockTypeId).toBe(seededData.feedstockType.id);
    expect(unchanged.version).toBe(beforeRefusal.version);

    // #674 shipped: concurrent different-feedstock cohorts are valid above;
    // the same facility, feedstock and production window must still conflict.
    await page.goto(`/credit-batches?facility=${seededData.facility.id}&create=true`);
    await waitForFacilityHydration(page, seededData.facility.name);
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "Create credit batch", exact: true })).toBeVisible();
    await selectEntity(page, "Feedstock type", seededData.feedstockType.id, seededData.feedstockType.name);
    // Native date inputs have no implicit textbox role. Their FormField labels
    // explicitly target the input ids in credit-batch-form.tsx.
    await createDialog.getByLabel("Start date").fill(productionDay);
    await createDialog.getByLabel("End date").fill(productionDay);
    await createDialog.getByRole("button", { name: "Create credit batch", exact: true }).click();
    await expect(createDialog.getByRole("alert")).toHaveText(
      `This production cohort overlaps credit batch ${first.code}. Use a non-overlapping window for the same facility and feedstock.`,
    );
    const remainingBatches = await connection.db.select({ id: schema.creditBatches.id }).from(schema.creditBatches).where(and(
      eq(schema.creditBatches.organizationId, DEC_ORG_ID),
      eq(schema.creditBatches.facilityId, seededData.facility.id),
    ));
    expect(remainingBatches.map((batch) => batch.id).sort()).toEqual([...batchIds].sort());
  } finally {
    // Run every registered cleanup even if one fails; unwind the two ready
    // chains before their intake, bins, types and shared facility mapping.
    const errors: unknown[] = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    await connection.pool.end();
    if (errors.length) throw new AggregateError(errors, "Concurrent feedstock fixture cleanup failed");
  }
});
