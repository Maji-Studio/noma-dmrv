import { createOperationActivity } from "@/lib/operations/activity-links";
import type { DbTransaction } from "@/db";
import type { Delivery } from "@/db/schema";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/data-access/delivery-output-writes", () => ({ createDeliveryInTransaction: mocks.create, updateDeliveryInTransaction: mocks.update }));
vi.mock("./output-stock", () => ({ GENERATED_MOVEMENT_KEY_PREFIX: "generated:" }));
vi.mock("./runner", () => ({ runOperationInProcess: vi.fn() }));

import { describeRecordedDelivery, describeUpdatedDelivery, recordDeliveryForUi, updateDeliveryOperation, updatePostedDelivery } from "./deliveries";

const ID = "00000000-0000-4000-8000-000000000001";
const VERSION = 2;
const ctx = { organizationId: "org", userId: "operator", orgRole: "owner" as const, isPlatformAdmin: false };
const scope = { ctx, source: "form" as const, tx: {} as DbTransaction, activity: createOperationActivity(), afterCommit: vi.fn() };
const input = { deliveryId: ID, expectedVersion: VERSION };

beforeEach(() => vi.resetAllMocks());

it("returns only delivery facts from registered PATCH, leaving native UI rows available", async () => {
  const delivery = { id: ID, code: "DL-001", version: VERSION + 1 } as Delivery;
  mocks.update.mockResolvedValue({ ...delivery, savedProducts: [] });
  expect(await updateDeliveryOperation.execute(scope, input)).toEqual(delivery);
  expect(mocks.update).toHaveBeenCalledWith(ctx, scope.tx, ID, { expectedVersion: VERSION }, scope.activity.capture);
  expect(await updatePostedDelivery.execute(scope, updatePostedDelivery.input.parse(input))).toEqual({ ...delivery, savedProducts: [] });
  expect(updatePostedDelivery.describe!(input, { ...delivery, savedProducts: [] })).toEqual({
    outcome: "updated", entityType: "delivery", entityIds: [ID], versionBefore: VERSION,
    versionAfter: VERSION + 1, changedFields: [],
  });
});

it("does not describe an already-posted UI delivery as a new write", async () => {
  const output = { delivery: { id: ID, version: VERSION }, basisFingerprint: "basis", allocations: [] };
  mocks.create.mockImplementationOnce(async (_ctx, _tx, _input, options) => { options.onReplay(); return output; });
  const input = recordDeliveryForUi.input.parse({
    orderId: ID, storageLocationId: ID, deliveredAt: "2026-09-14T12:00:00Z",
    deliveredWetMassKg: 10, moisturePercent: 20, idempotencyKey: "form-key",
  });
  const saved = await recordDeliveryForUi.execute(scope, input);
  expect(saved).toBe(output);
  expect(scope.activity.skipped).toBe(true);
  expect(describeRecordedDelivery(input, { delivery: output.delivery })?.outcome).toBe("created");
});

it("excludes the correction precondition from a delivery's changed fields", () => {
  const changes = { ...input, correctsMovementId: ID, deliveredWetMassKg: 10 };
  expect(describeUpdatedDelivery(changes, {
    id: ID, version: VERSION + 1,
  }).changedFields).toEqual([]);
});
