import { recordDelivery, updateDeliveryOperation } from "./deliveries";
import { recordOrder, updateOrder, deleteOrder } from "./orders";
import { startProductionRun, updateProductionRun, deleteProductionRun } from "./production-runs";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "./feedstocks";
import { recordOutputStockMovement } from "./output-stock";
import { makeBiocharProduct, updateBiocharProduct } from "./biochar-products";
import { recordLabSample, updateLabSample, deleteLabSample } from "./lab-samples";

/** Explicit write allowlist. Existing read models become the read side later. */
export const operationRegistry = {
  record_delivery: recordDelivery,
  update_delivery: updateDeliveryOperation,
  record_order: recordOrder,
  update_order: updateOrder,
  delete_order: deleteOrder,
  start_production_run: startProductionRun,
  update_production_run: updateProductionRun,
  delete_production_run: deleteProductionRun,
  log_feedstock_delivery: logFeedstockDelivery,
  update_feedstock: updateFeedstock,
  delete_feedstock: deleteFeedstock,
  record_output_stock_movement: recordOutputStockMovement,
  make_biochar_product: makeBiocharProduct,
  update_biochar_product: updateBiocharProduct,
  record_lab_sample: recordLabSample,
  update_lab_sample: updateLabSample,
  delete_lab_sample: deleteLabSample,
} as const;

export type OperationId = keyof typeof operationRegistry;

export function getOperation<Id extends OperationId>(id: Id): (typeof operationRegistry)[Id];
export function getOperation(id: string): (typeof operationRegistry)[OperationId] | undefined;
export function getOperation(id: string): (typeof operationRegistry)[OperationId] | undefined {
  return Object.hasOwn(operationRegistry, id)
    ? operationRegistry[id as OperationId]
    : undefined;
}
