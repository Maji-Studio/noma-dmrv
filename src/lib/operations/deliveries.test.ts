import type { DbTransaction } from "@/db";
import type { Delivery } from "@/db/schema";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/data-access/delivery-output-writes", () => ({ createDeliveryInTransaction: mocks.create, updateDeliveryInTransaction: mocks.update }));
vi.mock("./output-stock", () => ({ GENERATED_MOVEMENT_KEY_PREFIX: "generated:" }));
vi.mock("./runner", () => ({ runOperationInProcess: vi.fn() }));

import { updateDeliveryOperation, updatePostedDelivery } from "./deliveries";

const ID = "00000000-0000-4000-8000-000000000001";
const VERSION = 2;
const ctx = { organizationId: "org", userId: "operator", orgRole: "owner" as const, isPlatformAdmin: false };
const scope = { ctx, tx: {} as DbTransaction, afterCommit: vi.fn() };
const input = { deliveryId: ID, expectedVersion: VERSION };

beforeEach(() => vi.resetAllMocks());

it("returns only delivery facts from registered PATCH, leaving native UI rows available", async () => {
  const delivery = { id: ID, code: "DL-001", version: VERSION + 1 } as Delivery;
  mocks.update.mockResolvedValue({ ...delivery, savedProducts: [] });
  expect(await updateDeliveryOperation.execute(scope, input)).toEqual(delivery);
  expect(mocks.update).toHaveBeenCalledWith(ctx, scope.tx, ID, { expectedVersion: VERSION });
  expect(await updatePostedDelivery.execute(scope, updatePostedDelivery.input.parse(input))).toEqual({ ...delivery, savedProducts: [] });
});
