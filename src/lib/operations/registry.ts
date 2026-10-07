import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "./feedstocks";

/** Explicit write allowlist. Existing read models become the read side later. */
export const operationRegistry = {
  log_feedstock_delivery: logFeedstockDelivery,
  update_feedstock: updateFeedstock,
  delete_feedstock: deleteFeedstock,
} as const;

export type OperationId = keyof typeof operationRegistry;

export function getOperation<Id extends OperationId>(id: Id): (typeof operationRegistry)[Id];
export function getOperation(id: string): (typeof operationRegistry)[OperationId] | undefined;
export function getOperation(id: string): (typeof operationRegistry)[OperationId] | undefined {
  return Object.hasOwn(operationRegistry, id)
    ? operationRegistry[id as OperationId]
    : undefined;
}
