/** Cross-transport preconditions and sibling versions. Reviewer execution only. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedstockFn, deleteFeedstockFn, updateFeedstockFn } from "@/fn/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import { FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import {
  binWetStock, committedFeedstocks, createApiFeedstockFixture, decodedIntake,
  deleteFeedstock, derivedFeedstockLegs, expectFeedstockProblem, getFeedstock,
  patchFeedstock, readFeedstock, removeApiFeedstockFixture, seedApiFeedstock,
  type ApiFeedstockFixture,
} from "./helpers/api-feedstock-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(),
  requireOrgContext: auth.requireOrgContext,
}));

const SUITE_TIMEOUT_MS = 30_000;
const INITIAL_VERSION = 1;
const VERSION_INCREMENT = 1;
const NEXT_VERSION = 2;
const THIRD_VERSION = 3;
const INTAKE_WET_KG = 100;
const UPDATED_WET_KG = 80;
const UPDATED_DRY_KG = 54;
const UPDATED_DISTANCE_KM = 31;
const DISTANCE_ONLY_KM = 42;
const TRANSPORTS = ["action", "rest"] as const;
type Transport = typeof TRANSPORTS[number];
const etagAt = (version: number) => `"${version}.${FEEDSTOCK_REPRESENTATION_REVISION}"`;

let fixture: ApiFeedstockFixture;
beforeEach(async () => {
  fixture = await createApiFeedstockFixture("versions");
  auth.requireOrgContext.mockResolvedValue(fixture.ctx);
});
afterEach(async () => {
  await removeApiFeedstockFixture(fixture);
  auth.requireOrgContext.mockReset();
});

/** Project the native action result without using the REST serializer. */
function actionRepresentation(row: FeedstockWithRelations) {
  return feedstockRepresentationSchema.parse({
    ...row, deliveryDate: row.deliveryDate?.toISOString().split("T")[0] ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}

async function updateThrough(transport: Transport, saved: Awaited<ReturnType<typeof seedApiFeedstock>>, patch: Parameters<typeof updateFeedstockFn>[0]) {
  if (transport === "action") {
    const result = await updateFeedstockFn(patch);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(`Action update refused: ${result.code}`);
    return actionRepresentation(result.data);
  }
  const { feedstockId, expectedVersion, ...body } = patch;
  expect(feedstockId).toBe(saved.row.id);
  expect(expectedVersion).toBe(saved.row.version);
  const response = await patchFeedstock(fixture, saved.row, saved.etag, body);
  expect(response.status).toBe(200);
  expect(response.headers.get("etag")).toBe(etagAt(saved.row.version + VERSION_INCREMENT));
  return feedstockRepresentationSchema.parse((await response.json()).data);
}

const orders: { first: Transport; winner: "update" | "delete"; loser: "update" | "delete" }[] = TRANSPORTS.flatMap((first) => [
  { first, winner: "update", loser: "update" },
  { first, winner: "update", loser: "delete" },
  { first, winner: "delete", loser: "update" },
]);

describe("feedstock version cascade across action and REST", { timeout: SUITE_TIMEOUT_MS }, () => {
  it.each(orders)("$first $winner refuses the other transport's stale $loser", async ({ first, winner, loser }) => {
    const saved = await seedApiFeedstock(fixture, INTAKE_WET_KG);
    expect(saved.row.version).toBe(INITIAL_VERSION);
    const target = { feedstockId: saved.row.id, expectedVersion: saved.row.version };
    let current;
    if (winner === "update") {
      current = await updateThrough(first, saved, { ...target, massWetKg: UPDATED_WET_KG, notes: "First writer" });
      expect(current).toMatchObject({ version: NEXT_VERSION, massWetKg: UPDATED_WET_KG, massDryKg: UPDATED_DRY_KG, notes: "First writer" });
      const read = await readFeedstock(fixture, saved.row.id);
      expect(read.row).toEqual(current);
      expect(read.etag).toBe(etagAt(NEXT_VERSION));
      expect(read.etag).not.toBe(saved.etag);
    } else if (first === "action") {
      expect(await deleteFeedstockFn(target)).toEqual({ success: true, data: undefined });
    } else {
      expect((await deleteFeedstock(fixture, saved.row, saved.etag)).status).toBe(204);
    }

    const beforeRefusal = await committedFeedstocks(fixture);
    const stockBeforeRefusal = await binWetStock(fixture);
    const code = winner === "delete" ? "not_found" : "stale_version";
    if (first === "action") {
      const response = loser === "update"
        ? await patchFeedstock(fixture, saved.row, saved.etag, { notes: "Stale draft" })
        : await deleteFeedstock(fixture, saved.row, saved.etag);
      const failure = await expectFeedstockProblem(response, winner === "delete" ? 404 : 412, code);
      if (winner === "update") expect(failure.current).toEqual(current);
    } else {
      const failure = loser === "update"
        ? await updateFeedstockFn({ ...target, notes: "Stale draft" })
        : await deleteFeedstockFn(target);
      expect(failure).toMatchObject({ success: false, code });
      if (winner === "update") expect(failure).toMatchObject({ conflict: { entity: "feedstock", id: saved.row.id } });
    }
    expect(await committedFeedstocks(fixture)).toEqual(beforeRefusal);
    expect(await binWetStock(fixture)).toBe(stockBeforeRefusal);
    expect(stockBeforeRefusal).toBe(winner === "delete" ? 0 : UPDATED_WET_KG);
    if (winner === "delete") {
      expect(beforeRefusal).toEqual([]);
      await expectFeedstockProblem(await getFeedstock(fixture, saved.row.id), 404, "not_found");
    }
  });

  it.each(TRANSPORTS)("%s bumps the resynced transport leg and the feedstock, including distance-only updates", async (transport) => {
    // Create through the UI here as well, rather than only exercising actions
    // against rows seeded by REST.
    const created = await createFeedstockFn(decodedIntake(fixture, INTAKE_WET_KG));
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(`Action create refused: ${created.code}`);
    expect(created.data.feedstocks).toHaveLength(1);
    const saved = await readFeedstock(fixture, created.data.feedstocks[0].id);
    const initialLegs = await derivedFeedstockLegs(fixture, saved.row.id);
    expect(initialLegs).toHaveLength(1);
    const [initialLeg] = initialLegs;
    expect(initialLeg).toMatchObject({ version: INITIAL_VERSION, loadMassKg: INTAKE_WET_KG });

    const updated = await updateThrough(transport, saved, {
      feedstockId: saved.row.id, expectedVersion: saved.row.version,
      massWetKg: UPDATED_WET_KG, transportDistanceKm: UPDATED_DISTANCE_KM, transportDistanceSource: "manual",
    });
    const legs = await derivedFeedstockLegs(fixture, saved.row.id);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      id: initialLeg.id, version: initialLeg.version + VERSION_INCREMENT,
      loadMassKg: UPDATED_WET_KG, distanceKm: UPDATED_DISTANCE_KM, distanceSource: "manual",
    });
    expect(updated.version).toBe(NEXT_VERSION);
    expect(await binWetStock(fixture)).toBe(UPDATED_WET_KG);

    const read = await readFeedstock(fixture, saved.row.id);
    expect(read.row).toEqual(updated);
    const distanceOnly = await updateThrough(transport, read, {
      feedstockId: saved.row.id, expectedVersion: read.row.version, transportDistanceKm: DISTANCE_ONLY_KM,
    });
    const distanceLegs = await derivedFeedstockLegs(fixture, saved.row.id);
    expect(distanceLegs).toHaveLength(1);
    expect(distanceLegs[0]).toMatchObject({
      id: initialLeg.id, version: THIRD_VERSION, distanceKm: DISTANCE_ONLY_KM, loadMassKg: UPDATED_WET_KG,
    });
    expect(distanceOnly).toEqual({ ...updated, version: THIRD_VERSION, updatedAt: distanceOnly.updatedAt });
    const latest = await readFeedstock(fixture, saved.row.id);
    expect(latest.etag).toBe(etagAt(THIRD_VERSION));
    expect(latest.row).toEqual(distanceOnly);
    expect(await binWetStock(fixture)).toBe(UPDATED_WET_KG);
  });
});
