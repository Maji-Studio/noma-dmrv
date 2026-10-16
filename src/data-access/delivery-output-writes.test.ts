import type { DbTransaction } from "@/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ posting: vi.fn(), post: vi.fn(), select: vi.fn(), sync: vi.fn(), transaction: vi.fn(), replay: vi.fn(), lineage: vi.fn() }));
// Every I/O seam is mocked; this suite never opens a database connection.
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./output-stock-post", () => ({ withOutputStockPostingInTransaction: mocks.posting, findPostedOutputRequest: mocks.replay, OUTPUT_STOCK_FUTURE_TIME_MESSAGE: "Date and time cannot be in the future." }));
vi.mock("./utils", () => ({ requireOrgScope: vi.fn(), assertSameOrg: vi.fn() }));
vi.mock("./certification-lineage-guards", () => ({ assertCanMutateCertifiedLineage: mocks.lineage, lockCertifiedLineageArtifacts: vi.fn(), assertLockedLineagesAllowMutation: vi.fn() }));
vi.mock("./bin-movement-requests", () => ({ lockMovementRequest: vi.fn() }));
vi.mock("./delivery-order-balance", () => ({ lockDeliveryOrderAndAssertBalance: vi.fn() }));
vi.mock("./lock-bin-stocks", () => ({ lockBinStock: vi.fn() }));
vi.mock("./output-stock", () => ({ getOutputStockAllocationProjection: vi.fn() }));
vi.mock("./delivery-distance-snapshot", () => ({ deliveryDistanceSnapshot: vi.fn().mockResolvedValue({ recordedDistanceKm: null, recordedDistanceSource: null }) }));
vi.mock("./transport-legs", () => ({ lockBiocharTransportRouteTopology: vi.fn(), syncBiocharProductTransportLegs: mocks.sync }));

vi.mock("./facility-reference-guards", () => ({ lockActiveFacilityReference: vi.fn() }));

import { createDeliveryInTransaction, updateDeliveryInTransaction } from "./delivery-output-writes";

const ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_VERSION = 2;
const ctx = { organizationId: "org", userId: "operator", orgRole: "owner" as const, isPlatformAdmin: false };
const input = {
  code: "DL-001", orderId: ID, facilityId: ID, storageLocationId: ID,
  deliveryDate: new Date("2026-09-14T12:00:00.000Z"), deliveredWetMassKg: 100,
  moistureContentPercent: 10, basisFingerprint: "basis", idempotencyKey: "request",
};
const delivery = { id: ID, code: input.code, massDryKg: 90 };
const savedProducts = [{ id: "product", version: PRODUCT_VERSION }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.post.mockResolvedValue({ preview: { removedDryKg: 90, allocations: [{ layerId: "product" }] }, moisturePercent: 10, savedProducts, movement: { id: "movement" } });
});

function transaction(rows: object[][]) {
  mocks.select.mockImplementation(() => {
    const result = rows.shift();
    const query = {
      from: () => query, where: () => query, for: async () => result,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  });
  const tx = {
    transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    select: mocks.select,
    insert: () => ({ values: () => ({ returning: async () => [delivery] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [delivery] }) }) }),
  };
  mocks.transaction.mockImplementation(fn => fn(tx));
  return tx;
}

it("types the update lineage guard's safe refusal at deliveryId without losing its message", async () => {
  const message = "Delivery DL-001 is locked by a certification submission.";
  mocks.lineage.mockRejectedValue(new SafeError(message));
  const tx = transaction([[{ ...delivery, facilityId: ID, storageLocationId: ID }]]);
  const update = updateDeliveryInTransaction(ctx, tx as unknown as DbTransaction, ID, { expectedVersion: 1, code: "DL-EDIT" });
  await expect(update).rejects.toBeInstanceOf(DomainError);
  await expect(update).rejects.toMatchObject({ code: "certification_locked", message, issues: [{ path: ["deliveryId"], code: "certification_locked", message }] });
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(mocks.sync).not.toHaveBeenCalled();
});

describe("delivery creation saved product rows", () => {
  it("returns the stock posting's bumped rows with the saved delivery without extra reads", async () => {
    const tx = transaction([[{ id: ID, facilityId: ID }], [{ id: ID, timezone: "UTC" }], [{ id: ID }], [{ timezone: "UTC" }], [{ id: ID, facilityId: ID, formulationId: "recipe" }], [{ id: ID, facilityId: ID, type: "product_bin", formulationId: "recipe" }], []]);
    mocks.posting.mockImplementation((_ctx, _tx, posting) => posting.write(tx, mocks.post));
    expect((await createDeliveryInTransaction(ctx, tx as unknown as DbTransaction, { code: input.code, orderId: ID, storageLocationId: ID, idempotencyKey: input.idempotencyKey, basisFingerprint: input.basisFingerprint, deliveredWetMassKg: input.deliveredWetMassKg, deliveredAt: input.deliveryDate, moisturePercent: input.moistureContentPercent })).delivery).toEqual({ ...delivery, savedProducts });
    expect(mocks.post).toHaveBeenCalledWith({ deliveryId: delivery.id });
    const posting = mocks.posting.mock.calls[0][2];
    expect(posting.input.reason).toBe("Delivery DL-001");
    expect(posting.payload).not.toHaveProperty("code");
    expect(posting.payload).not.toHaveProperty("reason");
    expect(mocks.select).toHaveBeenCalledTimes(7);
    expect(mocks.sync).toHaveBeenCalledWith(ctx, tx, [savedProducts[0].id]);
  });

  it("returns no saved product rows on replay and does not post stock again", async () => {
    const tx = transaction([[delivery], []]);
    mocks.replay.mockResolvedValue({ id: "movement", inputSnapshot: { deliveryId: delivery.id } });
    expect((await createDeliveryInTransaction(ctx, tx as unknown as DbTransaction, { code: input.code, orderId: ID, storageLocationId: ID, idempotencyKey: input.idempotencyKey, basisFingerprint: input.basisFingerprint, deliveredWetMassKg: input.deliveredWetMassKg, deliveredAt: input.deliveryDate, moisturePercent: input.moistureContentPercent })).delivery).toEqual({ ...delivery, savedProducts: [] });
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
