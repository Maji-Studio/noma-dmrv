import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ posting: vi.fn(), post: vi.fn(), select: vi.fn(), sync: vi.fn() }));
// Every I/O seam is mocked; this suite never opens a database connection.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./output-stock-post", () => ({ withOutputStockPosting: mocks.posting }));
vi.mock("./utils", () => ({ requireOrgScope: vi.fn(), assertSameOrg: vi.fn() }));
vi.mock("./certification-lineage-guards", () => ({ assertCanMutateCertifiedLineage: vi.fn() }));
vi.mock("./delivery-order-balance", () => ({ lockDeliveryOrderAndAssertBalance: vi.fn() }));
vi.mock("./lock-bin-stocks", () => ({ lockBinStock: vi.fn() }));
vi.mock("./output-stock", () => ({ getOutputStockAllocationProjection: vi.fn() }));
vi.mock("./transport-legs", () => ({ lockBiocharTransportRouteTopology: vi.fn(), syncBiocharProductTransportLegs: mocks.sync }));

import { createDelivery } from "./delivery-output-writes";

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
  mocks.post.mockResolvedValue({ preview: { removedDryKg: 90, allocations: [{ layerId: "product" }] }, moisturePercent: 10, savedProducts });
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
  return {
    select: mocks.select,
    insert: () => ({ values: () => ({ returning: async () => [delivery] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [delivery] }) }) }),
  };
}

describe("delivery creation saved product rows", () => {
  it("returns the stock posting's bumped rows with the saved delivery without extra reads", async () => {
    const tx = transaction([[{ id: ID }], [{ id: ID, formulationId: "recipe" }], [{ id: ID, formulationId: "recipe" }]]);
    mocks.posting.mockImplementation((_ctx, posting) => posting.write(tx, mocks.post));
    expect(await createDelivery(ctx, input)).toEqual({ ...delivery, savedProducts });
    expect(mocks.post).toHaveBeenCalledWith({ deliveryId: delivery.id });
    expect(mocks.select).toHaveBeenCalledTimes(3);
    expect(mocks.sync).toHaveBeenCalledWith(ctx, tx, [savedProducts[0].id]);
  });

  it("returns no saved product rows on replay and does not post stock again", async () => {
    const tx = transaction([[delivery]]);
    mocks.posting.mockImplementation((_ctx, posting) => posting.replay(tx, { inputSnapshot: { deliveryId: delivery.id } }));
    expect(await createDelivery(ctx, input)).toEqual({ ...delivery, savedProducts: [] });
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
