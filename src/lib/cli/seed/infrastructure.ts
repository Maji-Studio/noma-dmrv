import { createFacilityFn, updateFacilityFn } from "@/fn/facilities";
import { createReactorFn } from "@/fn/reactors";
import { createSupplierWithLocationsFn } from "@/fn/suppliers";
import { createCustomerFn, createCustomerLocationFn } from "@/fn/customers";
import { createFormulationFn } from "@/fn/formulations";
import { createStorageLocationFn } from "@/fn/storage-locations";
import { createDriverFn, createOperatorFn, createVehicleFn } from "@/fn/quick-add";
import { createFacilitySchema } from "@/schemas/facilities";
import { createSupplierWithLocationsSchema } from "@/schemas/suppliers";
import { createCustomerLocationSchema } from "@/schemas/customers";
import { percentFormToRatioPayload } from "@/schemas/formulations";
import { CUSTOMER, CUSTOMER_LOCATION, EQUIPMENT, FACILITY, FORMULATION, MAFINGA_CODE, SUPPLIERS, SUPPLIER_LOCATION } from "./constants";
import { unwrap, type SeedCounts } from "./actions";
import { seedRegistryAndTypes } from "./registry";

export async function seedInfrastructure(counts: SeedCounts) {
  const facility = await unwrap("create facility", createFacilityFn(createFacilitySchema.parse(FACILITY)));
  counts.add("facilities");
  await unwrap("set facility idempotency code", updateFacilityFn({ facilityId: facility.id, code: MAFINGA_CODE }));
  const facilityId = facility.id;
  const types = await seedRegistryAndTypes(facilityId, counts);
  const reactor = await unwrap("create reactor", createReactorFn({ ...EQUIPMENT.reactor, facilityId }));
  counts.add("reactors");
  const suppliers = [];
  for (const [index, supplier] of SUPPLIERS.entries()) {
    suppliers.push(await unwrap(`create supplier ${index + 1} with location`, createSupplierWithLocationsFn(
      createSupplierWithLocationsSchema.parse({
        supplier: { name: supplier.name, sourceRegion: FACILITY.location },
        locations: [{ ...SUPPLIER_LOCATION, distanceFromFacilityKm: supplier.distanceKm }],
      }),
    )));
    counts.add("suppliers");
    counts.add("supplier locations");
  }
  const customer = await unwrap("create customer", createCustomerFn(CUSTOMER));
  counts.add("customers");
  const customerLocation = await unwrap("create customer location", createCustomerLocationFn(
    createCustomerLocationSchema.parse({ ...CUSTOMER_LOCATION, customerId: customer.id }),
  ));
  counts.add("customer locations");
  const formulation = await unwrap("create formulation", createFormulationFn(percentFormToRatioPayload({
    name: FORMULATION.name, biocharPercent: FORMULATION.biocharPercent,
    ingredients: [{ feedstockTypeId: types.manure.id, sharePercent: FORMULATION.ingredientPercent }],
  })));
  counts.add("formulations");
  const forestryBin = await unwrap("create forestry bin", createStorageLocationFn({
    facilityId, name: "Forestry waste", type: "feedstock_bin", feedstockTypeId: types.forestry.id,
  }));
  const manureBin = await unwrap("create manure bin", createStorageLocationFn({
    facilityId, name: "Chicken manure", type: "feedstock_bin", feedstockTypeId: types.manure.id,
  }));
  const biocharBin = await unwrap("create biochar bin", createStorageLocationFn({
    facilityId, name: "Biochar", type: "biochar_bin",
  }));
  const productBin = await unwrap("create product bin", createStorageLocationFn({
    facilityId, name: "BCF", type: "product_bin", formulationId: formulation.id,
  }));
  counts.add("storage bins", 4);
  const driver = await unwrap("quick add driver", createDriverFn(EQUIPMENT.driver));
  counts.add("drivers");
  const operator = await unwrap("quick add operator", createOperatorFn(EQUIPMENT.operator));
  counts.add("operators");
  const vehicle = await unwrap("quick add vehicle", createVehicleFn(EQUIPMENT.vehicle));
  counts.add("vehicles");
  return { facility, reactor, suppliers, customer, customerLocation, formulation, forestryBin, manureBin, biocharBin, productBin, driver, operator, vehicle, ...types };
}
export type Infrastructure = Awaited<ReturnType<typeof seedInfrastructure>>;
