import { createDeliveryInTransaction, updateDeliveryInTransaction, type UpdatedDelivery } from "@/data-access/delivery-output-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import type { OrgContext } from "@/lib/auth/server";
import { updateDeliverySchema } from "@/schemas/deliveries";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { recordDeliveryInput, updateDeliveryApiInput } from "@/schemas/delivery-input";
import { uuidSchema } from "@/schemas/helpers";
import type { Delivery } from "@/db/schema";
import type { OperationDescription } from "@/lib/operation-effect";
import { GENERATED_MOVEMENT_KEY_PREFIX } from "./output-stock";
import { runOperationInProcess, type Operation } from "./runner";


export const describeRecordedDelivery = (input: object, output: { delivery: Pick<Delivery, "id" | "version"> }): OperationDescription => ({
  outcome: "created", entityType: "delivery", entityIds: [output.delivery.id],
  versionBefore: null, versionAfter: output.delivery.version,
});

export const describeUpdatedDelivery = (input: { expectedVersion: number }, output: Pick<Delivery, "id" | "version">): OperationDescription => ({
  outcome: "updated", entityType: "delivery", entityIds: [output.id],
  versionBefore: input.expectedVersion, versionAfter: output.version,
});

/** Custom codes and stock request keys belong only to the native app path. */
const recordDeliveryUiInput = recordDeliveryInput.safeExtend({
  idempotencyKey: z.string().min(1).optional(),
  code: updateDeliveryApiInput.shape.code,
});
type PostedDelivery = Awaited<ReturnType<typeof createDeliveryInTransaction>>;

export const recordDeliveryForUi: Operation<typeof recordDeliveryUiInput, PostedDelivery> = {
  id: "record_posted_delivery", input: recordDeliveryUiInput, supportsDryRun: false,
  describe: describeRecordedDelivery,
  execute: async ({ ctx, tx, snapshotStock, activity }, input) => {
    const result = await createDeliveryInTransaction(ctx, tx, {
      ...input, idempotencyKey: input.idempotencyKey ?? `${GENERATED_MOVEMENT_KEY_PREFIX}${randomUUID()}`,
    }, { snapshotStock, onReplay: activity.skip });
    const row: Partial<typeof result.delivery> = { ...result.delivery };
    delete row.savedProducts;
    activity.capture(result.delivery.id, null, { ...row, allocations: result.allocations });
    activity.link({ facilityId: result.delivery.facilityId });
    return result;
  },
};

/** Product posting sequences are bigint; the public result contains delivery facts and allocations only. */
export const recordDelivery: Operation<typeof recordDeliveryInput, Omit<PostedDelivery, "delivery"> & { delivery: Delivery }> = {
  id: "record_delivery", input: recordDeliveryInput, supportsDryRun: true,
  describe: describeRecordedDelivery,
  execute: async (scope, input) => {
    const { delivery: saved, ...posting } = await recordDeliveryForUi.execute(scope, input);
    const delivery: Partial<typeof saved> = { ...saved };
    delete delivery.savedProducts;
    return { delivery: delivery as Delivery, ...posting };
  },
};

const updateDeliveryInput = updateDeliveryApiInput.extend({ deliveryId: uuidSchema() });
export const updateDeliveryOperation: Operation<typeof updateDeliveryInput, Delivery> = {
  id: "update_delivery", input: updateDeliveryInput, supportsDryRun: true,
  describe: describeUpdatedDelivery,
  execute: async ({ ctx, tx, afterCommit, activity }, { deliveryId, ...changes }) => {
    const saved = await updateDeliveryInTransaction(ctx, tx, deliveryId, changes, activity.capture);
    activity.link({ facilityId: saved.facilityId });
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    const delivery: Partial<typeof saved> = { ...saved };
    delete delivery.savedProducts;
    return delivery as Delivery;
  },
};

/** UI-only: the delivery row and its dependency-checked stock correction commit together. */
export const updatePostedDelivery: Operation<typeof updateDeliverySchema, UpdatedDelivery> = {
  id: "update_posted_delivery",
  input: updateDeliverySchema,
  supportsDryRun: false,
  describe: describeUpdatedDelivery,
  execute: async ({ ctx, tx, afterCommit, activity }, { deliveryId, ...changes }) => {
    const saved = await updateDeliveryInTransaction(ctx, tx, deliveryId, changes, activity.capture);
    activity.link({ facilityId: saved.facilityId });
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    return saved;
  },
};

export async function updateDelivery(ctx: OrgContext, deliveryId: string, changes: Omit<z.input<typeof updateDeliverySchema>, "deliveryId">): Promise<UpdatedDelivery> {
  return runOperationInProcess(updatePostedDelivery, ctx, { ...changes, deliveryId });
}
