/**
 * The stock form's action runs `record_output_stock_movement` in process. A
 * moved stock basis keeps the bin `conflict` the form refreshes from, now
 * under its own code. The operation runner is mocked; the posting itself runs
 * against the database in tests/operation-output-stock.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflictCode } from "@/lib/conflict-ref";
import { ActionConflictError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";

const mocks = vi.hoisted(() => ({ requireOrgContext: vi.fn(), runOperationInProcess: vi.fn(), loggerError: vi.fn(), correct: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.requireOrgContext }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: mocks.runOperationInProcess }));
vi.mock("@/lib/operations/output-stock", () => ({ recordOutputStockMovement: { id: "record_output_stock_movement" } }));
vi.mock("@/data-access/output-stock-operations", () => ({ getMatchingOutputBins: vi.fn(), getOutputStockHistory: vi.fn(), previewOutputStock: vi.fn() }));
vi.mock("@/data-access/output-stock-form-edits", () => ({ correctOutputStockEntry: mocks.correct }));
vi.mock("@/data-access/output-sub-bins", () => ({ getOutputSubBins: vi.fn() }));
vi.mock("@/lib/log", () => ({
  logger: { error: mocks.loggerError, child: () => ({ error: mocks.loggerError }) },
  sanitizeErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

import { postOutputStockFn } from "./output-stock";

const BIN_ID = "00000000-0000-4000-8000-000000000001";
const FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const ctx = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false };
const command = {
  storageLocationId: BIN_ID, facilityId: FACILITY_ID, occurredAt: "2026-09-14T12:00:00.000Z", kind: "loss" as const,
  wetMassKg: 10, moisturePercent: 20, expectedProductVersions: {}, basisFingerprint: "basis", idempotencyKey: "form-key", reason: "Spilled",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgContext.mockResolvedValue(ctx);
});

describe("postOutputStockFn", () => {
  it("runs the shared operation with the form's preview, fingerprint and request key", async () => {
    const saved = { movementId: "movement", basisFingerprint: "basis", preview: {}, savedProducts: [], savedDeliveries: [] };
    mocks.runOperationInProcess.mockResolvedValue(saved);
    expect(await postOutputStockFn(command)).toEqual({ success: true, data: saved });
    expect(mocks.runOperationInProcess).toHaveBeenCalledWith({ id: "record_output_stock_movement" }, ctx, expect.objectContaining(command));
  });

  it("keeps the bin conflict when the stock basis moved", async () => {
    const conflict = { entity: "storageLocation", id: BIN_ID, code: conflictCode("BC-001") };
    mocks.runOperationInProcess.mockRejectedValue(new DomainError("stock_basis_changed", "Stock changed since this preview. Refresh the preview and try again.", { conflict }));
    expect(await postOutputStockFn(command)).toEqual({
      success: false, error: "Stock changed since this preview. Refresh the preview and try again.", code: "stock_basis_changed", conflict,
    });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("validates the form before running the operation", async () => {
    expect(await postOutputStockFn({ ...command, reason: " " })).toMatchObject({ success: false, code: "validation_failed" });
    expect(mocks.runOperationInProcess).not.toHaveBeenCalled();
  });
});

it.each(["loss", "delivery"] as const)("returns a conflict for a locked %s form correction", async (kind) => {
  const conflict = { entity: "storageLocation", id: BIN_ID, code: conflictCode("BC-001") };
  mocks.correct.mockRejectedValue(new ActionConflictError("Locked because newer stock entries were recorded on this bin after it.", conflict));
  expect(await postOutputStockFn({ ...command, kind, correctsMovementId: FACILITY_ID })).toEqual({
    success: false, code: "conflict", error: "Locked because newer stock entries were recorded on this bin after it.", conflict,
  });
  expect(mocks.runOperationInProcess).not.toHaveBeenCalled();
});
