import { addSupplierLocation } from "@/lib/operations/supplier-locations";
import { addCustomerLocation, archiveCustomerLocation } from "@/lib/operations/customer-locations";
import type { OrgContext } from "@/lib/auth/server";
import { supplierEtag, customerEtag, supplierLocationEtag, customerLocationEtag } from "@/lib/api/representation-etags";
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
  fields.supplierLocationEtag = supplierLocationEtag(supplier.locations[0]);
  fields.customerLocationEtag = customerLocationEtag(customer.locations[0]);
  const spareSupplier = await runOperationInProcess(addSupplierLocation, ctx, {
    ...locations[0], isDefault: false, supplierId: supplier.supplier.id, name: "API fuzz delete pickup",
  }, scriptOptions);
  fields.deleteSupplierLocationId = spareSupplier.id;
  fields.deleteSupplierLocationParentId = supplier.supplier.id;
  fields.deleteSupplierLocationEtag = supplierLocationEtag(spareSupplier);
  for (const purpose of ["delete", "archive", "restore"] as const) {
    const parent = purpose === "delete" ? null : await runOperationInProcess(createCustomer, ctx, {
      name: `API fuzz location ${purpose} customer`, locations: [locations[0], {
        ...locations[0], isDefault: false, name: `API fuzz ${purpose} field`,
      }],
    }, scriptOptions);
    const parentId = parent?.customer.id ?? customer.customer.id;
    const location = parent ? parent.locations[1] : await runOperationInProcess(addCustomerLocation, ctx, {
      ...locations[0], isDefault: false, customerId: parentId, name: "API fuzz delete field",
    }, scriptOptions);
    const current = purpose === "restore" ? await runOperationInProcess(archiveCustomerLocation, ctx, {
      customerId: parentId, locationId: location.id, expectedVersion: location.version,
    }, scriptOptions) : location;
    fields[`${purpose}CustomerLocationId`] = current.id;
    fields[`${purpose}CustomerLocationParentId`] = parentId;
    fields[`${purpose}CustomerLocationEtag`] = customerLocationEtag(current);
  }
  return { supplier: supplier.supplier, supplierLocation: supplier.locations[0], customer: customer.customer,
    customerLocation: customer.locations[0], fields };
}
