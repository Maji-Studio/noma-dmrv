import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflictCode } from "@/lib/conflict-ref";
import { SafeError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ readBin: vi.fn(), record: vi.fn() }));
vi.mock("@/data-access/output-stock-post", () => ({ readOutputStockBin: mocks.readBin, recordOutputStockMovementInTransaction: mocks.record }));
import { OutputStockShortageError, StockBasisChangedError } from "@/data-access/output-stock-errors";
import { recordOutputStockMovementApiInput, recordOutputStockMovementInput } from "@/schemas/output-stock-movement-input";
import type { OperationScope } from "./runner";
import { GENERATED_MOVEMENT_KEY_PREFIX, recordOutputStockMovement } from "./output-stock";

const BIN_ID = "00000000-0000-4000-8000-000000000001";
const FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const LAYER_A = "00000000-0000-4000-8000-00000000000a";
const LAYER_B = "00000000-0000-4000-8000-00000000000b";
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const tx = {} as OperationScope["tx"];
const snapshotStock = vi.fn();
const scope: OperationScope = { ctx, tx, snapshotStock, afterCommit: vi.fn() };
const loss = { storageLocationId: BIN_ID, kind: "loss", occurredAt: "2026-09-14T12:00:00Z", wetMassKg: 10, moisturePercent: 20, reason: "Spilled" };
const execute = (input: unknown) => recordOutputStockMovement.execute(scope, recordOutputStockMovementInput.parse(input));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readBin.mockResolvedValue({ id: BIN_ID, facilityId: FACILITY_ID, timeZone: "Africa/Dar_es_Salaam" });
  mocks.record.mockResolvedValue({ movementId: "movement", basisFingerprint: "basis", preview: {}, savedProducts: [], savedDeliveries: [] });
});

describe("record_output_stock_movement", () => {
  it("takes the facility from the bin, reads a local time in its zone and generates a request key per execution", async () => {
    await execute({ ...loss, occurredAt: { date: "2026-09-14", time: "15:00" } });
    await execute({ ...loss, occurredAt: { date: "2026-09-14", time: "15:00" } });
    expect(mocks.readBin).toHaveBeenCalledWith(ctx, tx, { storageLocationId: BIN_ID, facilityId: undefined });
    const [first, second] = mocks.record.mock.calls.map(call => call[2]);
    expect(first).toMatchObject({ facilityId: FACILITY_ID, occurredAt: "2026-09-14T12:00:00.000Z", kind: "loss", wetMassKg: 10 });
    expect(first.idempotencyKey).toMatch(new RegExp(`^${GENERATED_MOVEMENT_KEY_PREFIX}[0-9a-f-]{36}$`));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(mocks.record.mock.calls[0][3]).toEqual({ snapshotStock });
  });

  it("keeps the form's request key, facility, preview versions and fingerprint", async () => {
    await execute({ ...loss, facilityId: FACILITY_ID, idempotencyKey: "form-key", basisFingerprint: "basis", expectedProductVersions: { [LAYER_A]: 2 } });
    expect(mocks.readBin).toHaveBeenCalledWith(ctx, tx, { storageLocationId: BIN_ID, facilityId: FACILITY_ID });
    expect(mocks.record.mock.calls[0][2]).toMatchObject({ idempotencyKey: "form-key", basisFingerprint: "basis", expectedProductVersions: { [LAYER_A]: 2 } });
  });

  it("answers a moved basis with stock_basis_changed and keeps the bin conflict", async () => {
    mocks.record.mockRejectedValue(new StockBasisChangedError({ id: BIN_ID, code: "BC-001" }));
    await expect(execute({ ...loss, basisFingerprint: "stale" })).rejects.toMatchObject({
      code: "stock_basis_changed", conflict: { entity: "storageLocation", id: BIN_ID, code: conflictCode("BC-001") },
    });
  });

  it("points a short sub-bin at its sources entry and a short bin at the mass", async () => {
    const sources = [{ layerId: LAYER_A, moisturePercent: 10 }, { layerId: LAYER_B, moisturePercent: 20 }];
    mocks.record.mockRejectedValueOnce(new OutputStockShortageError("Short.", { storageLocationId: BIN_ID, layerId: LAYER_B, availableSolidsKg: 1, requestedSolidsKg: 2 }));
    await expect(execute({ ...loss, moisturePercent: undefined, sources })).rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["sources", 1] }] });
    mocks.record.mockRejectedValueOnce(new OutputStockShortageError("Short.", { storageLocationId: BIN_ID, availableSolidsKg: 1, requestedSolidsKg: 2 }));
    await expect(execute(loss)).rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["wetMassKg"] }] });
  });

  it("keeps an invalid request a validation failure, not a shortage", async () => {
    mocks.record.mockRejectedValue(new SafeError("This load is used up before it reaches RUN-2. Untick RUN-2."));
    await expect(execute(loss)).rejects.toMatchObject({ code: "validation_failed", message: "This load is used up before it reaches RUN-2. Untick RUN-2." });
  });

  it("describes the movement it created without preconditions", async () => {
    const input = recordOutputStockMovementInput.parse({ ...loss, basisFingerprint: "basis", idempotencyKey: "form-key" });
    expect(recordOutputStockMovement.describe!(input, { movementId: "movement", basisFingerprint: "basis", preview: {} as never, savedProducts: [], savedDeliveries: [] })).toEqual({
      outcome: "created", entityType: "binMovement", entityIds: ["movement"], versionBefore: null, versionAfter: null,
      changedFields: ["kind", "moisturePercent", "occurredAt", "reason", "storageLocationId", "wetMassKg"],
    });
  });
});

describe("published movement body", () => {
  it("accepts losses and counts and refuses UI-only fields", () => {
    expect(recordOutputStockMovementApiInput.safeParse(loss).success).toBe(true);
    expect(recordOutputStockMovementApiInput.safeParse({ ...loss, kind: "count", wetMassKg: 0, moisturePercent: null }).success).toBe(true);
    for (const extra of [{ kind: "delivery" }, { correctsMovementId: LAYER_A }, { facilityId: FACILITY_ID }, { expectedProductVersions: {} }, { idempotencyKey: "key" }]) {
      expect(recordOutputStockMovementApiInput.safeParse({ ...loss, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("refuses an offset-free date-time and a count with sources", () => {
    expect(recordOutputStockMovementApiInput.safeParse({ ...loss, occurredAt: "2026-09-14T12:00:00" }).success).toBe(false);
    expect(recordOutputStockMovementApiInput.safeParse({ ...loss, kind: "count", sources: [{ layerId: LAYER_A, moisturePercent: 10 }] }).success).toBe(false);
  });
});
