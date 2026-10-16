import type { OrgContext } from "@/lib/auth/server";
import { supplierEtag, customerEtag } from "@/lib/api/representation-etags";
import { archiveSupplier, createSupplier } from "@/lib/operations/suppliers";
import { archiveCustomer, createCustomer } from "@/lib/operations/customers";
import { runOperationInProcess } from "@/lib/operations/runner";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";

const CUSTOMER_DISTANCE_KM = 25;
const scriptOptions = { activitySource: "script" as const };

/** Only the primary parties acquire intake/order references. Spares stay unused. */
export async function seedParties(ctx: OrgContext, facilityId: string) {
  const locations = [{ ...TEST_SITE_POSITION, name: "API fuzz location", country: "FR", isDefault: true,
    facilityDistances: [{ facilityId, distanceKm: CUSTOMER_DISTANCE_KM, distanceSource: "manual" as const }] }];
  const supplier = await runOperationInProcess(createSupplier, ctx, { name: "API fuzz fixture", locations }, scriptOptions);
  const customer = await runOperationInProcess(createCustomer, ctx, { name: "API fuzz fixture", locations }, scriptOptions);
  const fields: Record<string, string> = {
    supplierEtag: supplierEtag(supplier.supplier), customerEtag: customerEtag(customer.customer),
  };
  for (const purpose of ["delete", "archive", "restore"] as const) {
    const supplierResult = await runOperationInProcess(createSupplier, ctx, { name: `API fuzz ${purpose} supplier`, locations }, scriptOptions);
    const customerResult = await runOperationInProcess(createCustomer, ctx, { name: `API fuzz ${purpose} customer`, locations }, scriptOptions);
    const supplierRow = purpose === "restore" ? await runOperationInProcess(archiveSupplier, ctx, {
      supplierId: supplierResult.supplier.id, expectedVersion: supplierResult.supplier.version,
    }, scriptOptions) : supplierResult.supplier;
    const customerRow = purpose === "restore" ? await runOperationInProcess(archiveCustomer, ctx, {
      customerId: customerResult.customer.id, expectedVersion: customerResult.customer.version,
    }, scriptOptions) : customerResult.customer;
    fields[`${purpose}SupplierId`] = supplierRow.id;
    fields[`${purpose}SupplierCode`] = supplierRow.code;
    fields[`${purpose}SupplierEtag`] = supplierEtag(supplierRow);
    fields[`${purpose}CustomerId`] = customerRow.id;
    fields[`${purpose}CustomerCode`] = customerRow.code;
    fields[`${purpose}CustomerEtag`] = customerEtag(customerRow);
  }
  return { supplier: supplier.supplier, supplierLocation: supplier.locations[0], customer: customer.customer,
    customerLocation: customer.locations[0], fields };
}
