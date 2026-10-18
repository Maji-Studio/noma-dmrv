import { addSupplierLocationApi, updateSupplierLocationApi, deleteSupplierLocationApi, addCustomerLocationApi, updateCustomerLocationApi, deleteCustomerLocationApi, archiveCustomerLocationApi, restoreCustomerLocationApi } from "./party-location-api";
import { createCustomerApi, updateCustomerApi, deleteCustomerApi, archiveCustomerApi, restoreCustomerApi } from "./customer-api";
import { deleteSupplier } from "./suppliers";
import { createSupplierApi, updateSupplierApi, archiveSupplierApi, restoreSupplierApi } from "./supplier-api";
import { deleteFormulation } from "./formulations";
import { createFormulationApi, updateFormulationApi, archiveFormulationApi, restoreFormulationApi } from "./formulation-api";
import { deleteApplication } from "./applications";
import { recordApplicationApi, updateApplicationApi } from "./application-api";
import { recordDelivery, updateDeliveryOperation } from "./deliveries";
import { recordOrder, updateOrder, deleteOrder } from "./orders";
import { startProductionRun, updateProductionRun, deleteProductionRun } from "./production-runs";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "./feedstocks";
import { recordOutputStockMovement } from "./output-stock";
import { makeBiocharProduct, updateBiocharProduct } from "./biochar-products";
import { recordLabSample, updateLabSample, deleteLabSample } from "./lab-samples";
import { requestDocumentUpload } from "./document-uploads";

/** Explicit write allowlist. Existing read models become the read side later. */
export const operationRegistry = {
  add_supplier_location: addSupplierLocationApi,
  update_supplier_location: updateSupplierLocationApi,
  delete_supplier_location: deleteSupplierLocationApi,
  add_customer_location: addCustomerLocationApi,
  update_customer_location: updateCustomerLocationApi,
  delete_customer_location: deleteCustomerLocationApi,
  archive_customer_location: archiveCustomerLocationApi,
  restore_customer_location: restoreCustomerLocationApi,

  create_customer: createCustomerApi,
  update_customer: updateCustomerApi,
  delete_customer: deleteCustomerApi,
  archive_customer: archiveCustomerApi,
  restore_customer: restoreCustomerApi,

  create_supplier: createSupplierApi,
  update_supplier: updateSupplierApi,
  delete_supplier: deleteSupplier,
  archive_supplier: archiveSupplierApi,
  restore_supplier: restoreSupplierApi,

  create_formulation: createFormulationApi,
  update_formulation: updateFormulationApi,
  delete_formulation: deleteFormulation,
  archive_formulation: archiveFormulationApi,
  restore_formulation: restoreFormulationApi,
  // The exposed contracts take raw GeoJSON; app actions call the envelope operations directly.
  record_application: recordApplicationApi,
  update_application: updateApplicationApi,
  delete_application: deleteApplication,
  request_document_upload: requestDocumentUpload,
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
