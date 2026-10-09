import { describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { createProductionRunInTransaction, updateProductionRunInTransaction } from "./mutations";

vi.mock("@/db", () => ({ db: {} }));
const ctx = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
const BIN_ID = "11111111-1111-4111-8111-111111111111";
const START = new Date("2026-01-01T10:00:00Z");
const END = new Date("2026-01-01T11:00:00Z");
const NOW = new Date("2026-01-02T00:00:00Z");
const DRAW_KG = 100;
const OUTPUT_KG = 20;

function preflightTransaction(responses: unknown[][]) {
  const insert = vi.fn();
  const update = vi.fn();
  const tx = { insert, update, select: () => {
    const rows = responses.shift();
    return { from: () => ({ where: async () => rows }) };
  } } as unknown as DbTransaction;
  return { tx, insert, update };
}

it("requires moisture on API-shaped terminal creation before writing", async () => {
  const state = preflightTransaction([[{ id: "facility", archivedAt: null }], [{ id: "reactor", facilityId: "facility" }]]);
  await expect(createProductionRunInTransaction(ctx, state.tx, {
    code: "PR-26-001", facilityId: "facility", reactorId: "reactor", status: "complete", startTime: START, endTime: END,
    feedstockDraws: [{ storageLocationId: BIN_ID, wetMassKg: DRAW_KG }],
    biocharOutputKg: OUTPUT_KG, biocharMoisturePercent: 0,
  }, { now: NOW })).rejects.toMatchObject({ code: "validation_failed", issues: [
    { path: ["feedstockMoisturePercent"], message: "Enter feedstock moisture." },
  ] });
  expect(state.insert).not.toHaveBeenCalled();
});

describe("merged terminal update prerequisites", () => {
  it.each(["complete", "failed"] as const)("rejects missing draws and moisture on %s", async (status) => {
    const state = preflightTransaction([[{ id: "run", facilityId: "facility", reactorId: "reactor", status: "running",
      startTime: START, endTime: null, feedstockWetMassKg: null, feedstockMoisturePercent: null }], []]);
    await expect(updateProductionRunInTransaction(ctx, state.tx, "run", {
      expectedVersion: 1, status, endTime: END, biocharOutputKg: OUTPUT_KG,
    }, { now: NOW })).rejects.toMatchObject({ code: "validation_failed", issues: [
      { path: ["feedstockDraws"], message: "Add at least one feedstock source." },
      { path: ["feedstockMoisturePercent"], message: "Enter feedstock moisture." },
    ] });
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each(["complete", "failed"] as const)("cannot clear the moisture of an existing %s run", async (status) => {
    const state = preflightTransaction([[{ id: "run", facilityId: "facility", reactorId: "reactor", status,
      startTime: START, endTime: END, feedstockWetMassKg: DRAW_KG, feedstockMoisturePercent: 20, biocharOutputKg: OUTPUT_KG }],
    [{ storageLocationId: BIN_ID }]]);
    await expect(updateProductionRunInTransaction(ctx, state.tx, "run", {
      expectedVersion: 1, feedstockMoisturePercent: null,
    }, { now: NOW })).rejects.toMatchObject({ code: "validation_failed", issues: [
      { path: ["feedstockMoisturePercent"], message: "Enter feedstock moisture." },
    ] });
    expect(state.update).not.toHaveBeenCalled();
  });
});

it("reports the missing source field even when terminal output exceeds an empty draw sum", async () => {
  const state = preflightTransaction([[{ id: "facility", archivedAt: null }], [{ id: "reactor", facilityId: "facility" }]]);
  await expect(createProductionRunInTransaction(ctx, state.tx, {
    code: "PR-26-001", facilityId: "facility", reactorId: "reactor", status: "complete", startTime: START, endTime: END,
    feedstockDraws: [], feedstockMoisturePercent: 20, biocharOutputKg: OUTPUT_KG, biocharMoisturePercent: 0,
  }, { now: NOW })).rejects.toMatchObject({ code: "validation_failed", issues: [
    { path: ["feedstockDraws"], message: "Add at least one feedstock source." },
  ] });
  expect(state.insert).not.toHaveBeenCalled();
});

it("refuses API-shaped failed creation before writing with a status pointer", async () => {
  const state = preflightTransaction([[{ id: "facility", archivedAt: null }], [{ id: "reactor", facilityId: "facility" }]]);
  await expect(createProductionRunInTransaction(ctx, state.tx, {
    code: "PR-26-001", facilityId: "facility", reactorId: "reactor", status: "failed", startTime: START, endTime: END,
    feedstockDraws: [{ storageLocationId: BIN_ID, wetMassKg: DRAW_KG }], feedstockMoisturePercent: 20,
  }, { now: NOW })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["status"] }] });
  expect(state.insert).not.toHaveBeenCalled();
});

it.each(["complete", "failed"] as const)("refuses output edits on %s without feedstock", async (status) => {
  const state = preflightTransaction([[{ id: "run", facilityId: "facility", reactorId: "reactor", status,
    startTime: START, endTime: END, feedstockWetMassKg: null, feedstockMoisturePercent: null }], []]);
  await expect(updateProductionRunInTransaction(ctx, state.tx, "run", {
    expectedVersion: 1, biocharOutputKg: OUTPUT_KG,
  }, { now: NOW })).rejects.toMatchObject({ code: "validation_failed", issues: [
    { path: ["feedstockDraws"] }, { path: ["feedstockMoisturePercent"] },
  ] });
  expect(state.update).not.toHaveBeenCalled();
});
