/** Real actions, REST handlers and Postgres. Reviewer execution only. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { createFeedstockFn, deleteFeedstockFn, updateFeedstockFn } from "@/fn/feedstocks";
import type { CreateFeedstockResult } from "@/data-access/feedstocks";
import {
  binWetStock, captureFeedstockState, committedFeedstocks, createApiFeedstockFixture, decodedIntake,
  deleteFeedstock, expectFeedstockProblem, patchFeedstock, postFeedstock,
  removeApiFeedstockFixture, restoreFeedstockState, seedApiFeedstock, seedFeedstockDraw,
  type ApiFeedstockFixture,
} from "./helpers/api-feedstock-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
// Keep withAction real: mockWithAction intentionally omits domain codes/issues.
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(),
  requireOrgContext: auth.requireOrgContext,
}));

const SUITE_TIMEOUT_MS = 30_000;
const INTAKE_WET_KG = 100;
const INTAKE_DRY_KG = 67.5;
const UPDATED_WET_KG = 80;
const UPDATED_MOISTURE_PERCENT = 25;
const UPDATED_DRY_KG = 60;
const DRAW_WET_KG = 10;
const OVERALLOCATION_WET_KG = 110;
const OVERALLOCATION_DRY_KG = 74.25;
const INVALID_WET_KG = -1;
const INITIAL_VERSION = 1;
const NEXT_VERSION = 2;

type Scenario = "create" | "create-warning" | "update" | "delete" | "validation" | "foreign-reference" | "stale" | "blocked-delete";
const cases: {
  scenario: Scenario; status: number; code: string; paths: (string | number)[][];
  rowCount: number; stock: number; wetKg: number; dryKg: number; version: number; notes: string | null;
}[] = [
  { scenario: "create", status: 201, code: "success", paths: [], rowCount: 1, stock: INTAKE_WET_KG, wetKg: INTAKE_WET_KG, dryKg: INTAKE_DRY_KG, version: INITIAL_VERSION, notes: null },
  { scenario: "create-warning", status: 201, code: "success", paths: [], rowCount: 1, stock: OVERALLOCATION_WET_KG, wetKg: OVERALLOCATION_WET_KG, dryKg: OVERALLOCATION_DRY_KG, version: INITIAL_VERSION, notes: null },
  { scenario: "update", status: 200, code: "success", paths: [], rowCount: 1, stock: UPDATED_WET_KG, wetKg: UPDATED_WET_KG, dryKg: UPDATED_DRY_KG, version: NEXT_VERSION, notes: "Updated intake" },
  { scenario: "delete", status: 204, code: "success", paths: [], rowCount: 0, stock: 0, wetKg: INTAKE_WET_KG, dryKg: INTAKE_DRY_KG, version: INITIAL_VERSION, notes: null },
  { scenario: "validation", status: 422, code: "validation_failed", paths: [["allocations", 0, "allocatedWetMassKg"]], rowCount: 0, stock: 0, wetKg: INTAKE_WET_KG, dryKg: INTAKE_DRY_KG, version: INITIAL_VERSION, notes: null },
  { scenario: "foreign-reference", status: 404, code: "not_found", paths: [["supplierId"]], rowCount: 0, stock: 0, wetKg: INTAKE_WET_KG, dryKg: INTAKE_DRY_KG, version: INITIAL_VERSION, notes: null },
  { scenario: "stale", status: 412, code: "stale_version", paths: [], rowCount: 1, stock: INTAKE_WET_KG, wetKg: INTAKE_WET_KG, dryKg: INTAKE_DRY_KG, version: NEXT_VERSION, notes: "Saved first" },
  { scenario: "blocked-delete", status: 409, code: "conflict", paths: [], rowCount: 1, stock: INTAKE_WET_KG - DRAW_WET_KG, wetKg: INTAKE_WET_KG, dryKg: INTAKE_DRY_KG, version: INITIAL_VERSION, notes: null },
];

let fixture: ApiFeedstockFixture;
let foreignFixture: ApiFeedstockFixture | undefined;

beforeEach(async () => {
  fixture = await createApiFeedstockFixture("parity");
  auth.requireOrgContext.mockResolvedValue(fixture.ctx);
});
afterEach(async () => {
  for (const entry of [fixture, foreignFixture]) {
    if (entry) await removeApiFeedstockFixture(entry);
  }
  foreignFixture = undefined;
  auth.requireOrgContext.mockReset();
});

function pointerPath(pointer: string): (string | number)[] {
  if (!pointer) return [];
  return pointer.slice(1).split("/").map((part) => {
    const decoded = part.replaceAll("~1", "/").replaceAll("~0", "~");
    return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
  });
}

function normalizedRows(rows: Awaited<ReturnType<typeof committedFeedstocks>>) {
  return rows.map(({ id, code, createdAt, updatedAt, ...row }, index) => {
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(code).toMatch(/^FS-\d{2}-\d{3,}$/);
    expect(createdAt).toBeInstanceOf(Date);
    expect(updatedAt).toBeInstanceOf(Date);
    return { id: `feedstock-${index}`, code: `feedstock-${index}`, ...row };
  });
}

async function prepare(fixture: ApiFeedstockFixture, scenario: Scenario) {
  if (["create", "create-warning", "validation", "foreign-reference"].includes(scenario)) return undefined;
  const saved = await seedApiFeedstock(fixture, INTAKE_WET_KG);
  if (scenario === "stale") {
    const updated = await patchFeedstock(fixture, saved.row, saved.etag, { notes: "Saved first" });
    expect(updated.status).toBe(200);
  }
  if (scenario === "blocked-delete") {
    await seedFeedstockDraw(fixture, [{ feedstockId: saved.row.id, wetMassUsedKg: DRAW_WET_KG }]);
  }
  return saved;
}

async function dispatch(
  fixture: ApiFeedstockFixture, scenario: Scenario, transport: "action" | "rest",
  saved: Awaited<ReturnType<typeof prepare>>,
) {
  if (!saved) {
    const command = decodedIntake(fixture, INTAKE_WET_KG);
    if (scenario === "validation") command.allocations[0].allocatedWetMassKg = INVALID_WET_KG;
    if (scenario === "foreign-reference") command.supplierId = foreignFixture!.supplierId;
    if (scenario === "create-warning") {
      command.allocations[0].allocatedWetMassKg = OVERALLOCATION_WET_KG;
      command.overrideJustification = "Scale adjustment";
    }
    return transport === "action" ? createFeedstockFn(command) : postFeedstock(fixture, command);
  }
  const target = { feedstockId: saved.row.id, expectedVersion: saved.row.version };
  if (scenario === "delete" || scenario === "blocked-delete") {
    return transport === "action" ? deleteFeedstockFn(target) : deleteFeedstock(fixture, saved.row, saved.etag);
  }
  const patch = scenario === "stale" ? { notes: "Stale draft" } : {
    massWetKg: UPDATED_WET_KG, moistureContentPercent: UPDATED_MOISTURE_PERCENT, notes: "Updated intake",
  };
  return transport === "action" ? updateFeedstockFn({ ...target, ...patch }) : patchFeedstock(fixture, saved.row, saved.etag, patch);
}

describe("feedstock action vs REST decoded-command parity", { timeout: SUITE_TIMEOUT_MS }, () => {
  it.each(cases)("$scenario: $code with equal committed rows and bin stock", async (testCase) => {
    if (testCase.scenario === "foreign-reference") foreignFixture = await createApiFeedstockFixture("parity-foreign");
    const saved = await prepare(fixture, testCase.scenario);
    const initialState = await captureFeedstockState(fixture);
    const action = await dispatch(fixture, testCase.scenario, "action", saved) as ActionResult<unknown>;
    const actionRows = await committedFeedstocks(fixture);
    const actionStock = await binWetStock(fixture);
    await restoreFeedstockState(fixture, initialState);
    const rest = await dispatch(fixture, testCase.scenario, "rest", saved) as Response;
    const restRows = await committedFeedstocks(fixture);
    const restStock = await binWetStock(fixture);
    expect(auth.requireOrgContext).toHaveBeenCalledTimes(1);
    expect(rest.status).toBe(testCase.status);
    // Successful ActionResult and REST envelopes have no code; normalize that
    // transport convention to the shared success outcome, preserving failures.
    const actionCode = action.success ? "success" : action.code;
    expect(actionCode).toBe(testCase.code);
    const actionPaths = action.success ? [] : (action.issues ?? []).map((issue) => issue.path);
    expect(actionPaths).toEqual(testCase.paths);
    if (action.success) {
      const body = rest.status === 204 ? undefined : await rest.json();
      expect(rest.ok ? "success" : body?.code).toBe(actionCode);
      if (testCase.scenario.startsWith("create")) {
        const warning = (action.data as CreateFeedstockResult).warning;
        expect(body.warnings ?? []).toEqual(warning ? [warning] : []);
        expect(Boolean(warning)).toBe(testCase.scenario === "create-warning");
      }
    } else {
      const body = await expectFeedstockProblem(rest, testCase.status, testCase.code);
      expect(body.errors.map((issue: { pointer: string }) => pointerPath(issue.pointer))).toEqual(actionPaths);
      expect(body.errors.map((issue: { code: string }) => issue.code)).toEqual((action.issues ?? []).map((issue) => issue.code));
    }

    expect(normalizedRows(restRows)).toEqual(normalizedRows(actionRows));
    for (const rows of [actionRows, restRows]) {
      expect(rows).toHaveLength(testCase.rowCount);
      if (testCase.rowCount) expect(rows[0]).toMatchObject({
        status: "complete", massWetKg: testCase.wetKg, massDryKg: testCase.dryKg,
        version: testCase.version, notes: testCase.notes,
      });
    }
    expect(actionStock).toBe(testCase.stock);
    expect(restStock).toBe(actionStock);
  });
});
