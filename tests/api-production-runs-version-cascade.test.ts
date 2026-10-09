/** DB-backed version and ETag contracts. Not run, needs the supervisor. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, reactors, storageLocations } from "@/db/schema";
import { PRODUCTION_RUN_REPRESENTATION_REVISION } from "@/config/api-rest";
import { updateProductionRunFn } from "@/fn/production-runs";
import { POST as MCP } from "@/app/api/mcp/route";
import { rpc, rpcBody } from "./helpers/mcp";
import {
  createApiProductionRunFixture, removeApiFeedstockFixture, seedApiFeedstock, patchFeedstock,
  readFeedstock, binWetStock, expectFeedstockProblem as problem, type ApiProductionRunFixture,
} from "./helpers/api-feedstock-fixture";
import {
  seedApiProductionRun, readProductionRun, patchProductionRun, deleteProductionRun, captureProductionRunState,
  completionPatch, RUN_DRAW_WET_KG, RUN_INTAKE_WET_KG, INITIAL_RUN_VERSION,
} from "./helpers/api-production-run-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 30_000;
const REDUCED_INTAKE_KG = 4000;
const UPDATED_MOISTURE_PERCENT = 25;
const REPLACEMENT_DRAW_KG = 600;
const FEEDING_RATE_KG_HR = 500;
const PREVIOUS_REPRESENTATION_REVISION = 1;
let fixture: ApiProductionRunFixture;
beforeEach(async () => {
  fixture = await createApiProductionRunFixture("run-version");
  auth.requireOrgContext.mockResolvedValue(fixture.ctx);
});
afterEach(async () => { await removeApiFeedstockFixture(fixture); auth.requireOrgContext.mockReset(); });
const etagAt = (version: number) => `"${version}.${PRODUCTION_RUN_REPRESENTATION_REVISION}"`;

describe("production run version cascades", { timeout: TIMEOUT_MS }, () => {
  it.each(["action", "rest", "mcp"] as const)("%s PATCH bumps the run, draw replacement and completion each reject their stale If-Match", async (transport) => {
    await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    let saved = await seedApiProductionRun(fixture);
    expect(saved.etag).toBe(etagAt(INITIAL_RUN_VERSION));
    for (const patch of [
      { feedingRateKgHr: FEEDING_RATE_KG_HR },
      { feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: REPLACEMENT_DRAW_KG }] },
      completionPatch(fixture),
    ]) {
      const target = { productionRunId: saved.row.id, expectedVersion: saved.row.version };
      if (transport === "action") {
        const input = "endTime" in patch ? { ...patch, endTime: new Date(patch.endTime) } : patch;
        expect(await updateProductionRunFn({ ...target, ...input })).toMatchObject({ success: true });
      } else if (transport === "mcp") {
        const { result } = await rpcBody(await MCP(rpc(fixture.key, "tools/call", {
          name: "update_production_run", arguments: { ...target, ...patch, requestKey: crypto.randomUUID() },
        })));
        expect(result.isError).not.toBe(true);
      } else expect((await patchProductionRun(fixture, saved.row, saved.etag, patch)).status).toBe(200);
      const current = await readProductionRun(fixture, saved.row.id);
      expect(current.row.version).toBe(saved.row.version + 1);
      expect(current.etag).toBe(etagAt(current.row.version));
      const state = await captureProductionRunState(fixture);
      for (const refusal of [
        await patchProductionRun(fixture, saved.row, saved.etag, { feedingRateKgHr: FEEDING_RATE_KG_HR }),
        await deleteProductionRun(fixture, saved.row, saved.etag),
      ]) {
        expect((await problem(refusal, 412, "stale_version")).current).toEqual(current.row);
      }
      expect(await captureProductionRunState(fixture)).toEqual(state);
      saved = current;
    }
    expect(await binWetStock(fixture)).toBe(RUN_INTAKE_WET_KG - REPLACEMENT_DRAW_KG);
  });

  it("feedstock edits bump their own version without cascading to the run's recorded draw or measured moisture", async () => {
    let intake = await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    const saved = await seedApiProductionRun(fixture);
    const original = await captureProductionRunState(fixture);
    // database.md's shared-bin lock order serializes stock changes. The writer in
    // feedstocks.ts does not rewrite productionRuns, draws or provenance rows.
    for (const patch of [{ notes: "Intake correction" }, { moistureContentPercent: UPDATED_MOISTURE_PERCENT }, { massWetKg: REDUCED_INTAKE_KG }]) {
      expect((await patchFeedstock(fixture, intake.row, intake.etag, patch)).status).toBe(200);
      const currentIntake = await readFeedstock(fixture, intake.row.id);
      expect(currentIntake.row.version).toBe(intake.row.version + 1);
      expect((await problem(await patchFeedstock(fixture, intake.row, intake.etag, patch), 412, "stale_version")).current).toEqual(currentIntake.row);
      expect(await readProductionRun(fixture, saved.row.id)).toEqual(saved);
      const current = await captureProductionRunState(fixture);
      expect(current.runs).toEqual(original.runs);
      expect(current.draws).toEqual(original.draws);
      expect(current.allocations).toEqual(original.allocations);
      intake = currentIntake;
    }
    expect(await binWetStock(fixture)).toBe(REDUCED_INTAKE_KG - RUN_DRAW_WET_KG);
    // Since no represented run state changed, this tag remains valid.
    expect((await patchProductionRun(fixture, saved.row, saved.etag, { feedingRateKgHr: FEEDING_RATE_KG_HR })).status).toBe(200);
  });

  it("reference renames and a facility-zone change leave the run body and ETag unchanged", async () => {
    await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    const saved = await seedApiProductionRun(fixture);
    expect((await patchProductionRun(fixture, saved.row, saved.etag, completionPatch(fixture))).status).toBe(200);
    const completed = await readProductionRun(fixture, saved.row.id);
    const org = fixture.ctx.organizationId;
    await db.update(reactors).set({ code: "R-RENAMED" }).where(and(eq(reactors.organizationId, org), eq(reactors.id, fixture.reactorId)));
    await db.update(storageLocations).set({ code: "B-RENAMED" }).where(and(eq(storageLocations.organizationId, org), eq(storageLocations.id, fixture.binId)));
    await db.update(storageLocations).set({ code: "OUT-RENAMED" }).where(and(eq(storageLocations.organizationId, org), eq(storageLocations.id, fixture.outputBinId)));
    await db.update(facilities).set({ code: "FAC-RENAMED", timezone: "Pacific/Auckland" }).where(and(eq(facilities.organizationId, org), eq(facilities.id, fixture.facilityId)));
    expect(await readProductionRun(fixture, saved.row.id)).toEqual(completed);
    for (const key of ["facilityCode", "timeZone", "reactorCode", "biocharStorageLocationCode"]) expect(completed.row).not.toHaveProperty(key);
    expect(completed.row.feedstockDraws[0]).not.toHaveProperty("storageLocationCode");
  });

  it("rejects the old representation revision even at the current row version", async () => {
    await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    const saved = await seedApiProductionRun(fixture);
    const oldTag = `"${saved.row.version}.${PREVIOUS_REPRESENTATION_REVISION}"`;
    expect(oldTag).not.toBe(saved.etag);
    const state = await captureProductionRunState(fixture);
    const refusal = await patchProductionRun(fixture, saved.row, oldTag, { feedingRateKgHr: FEEDING_RATE_KG_HR });
    expect((await problem(refusal, 412, "stale_version")).current).toEqual(saved.row);
    expect(await captureProductionRunState(fixture)).toEqual(state);
  });
});
