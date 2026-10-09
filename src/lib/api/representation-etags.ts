import { PRODUCTION_RUN_REPRESENTATION_REVISION, REACTOR_REPRESENTATION_REVISION } from "@/config/api-rest";
import {
  SUPPLIER_REPRESENTATION_REVISION,
  VEHICLE_REPRESENTATION_REVISION,
  FACILITY_REPRESENTATION_REVISION,
  STORAGE_LOCATION_REPRESENTATION_REVISION,
  FEEDSTOCK_REPRESENTATION_REVISION,
  DRIVER_REPRESENTATION_REVISION,
  FEEDSTOCK_TYPE_REPRESENTATION_REVISION,
} from "@/config/api-rest";
import { representationEtag } from "./etag";
import type { SupplierRepresentation } from "@/lib/representations/suppliers";
import type { VehicleRepresentation } from "@/lib/representations/vehicles";
import type { FacilityRepresentation } from "@/lib/representations/facilities";
import type { StorageLocationRepresentation } from "@/lib/representations/storage-locations";
import type { FeedstockRepresentation } from "@/lib/representations/feedstocks";
import type { DriverRepresentation } from "@/lib/representations/drivers";
import type { FeedstockTypeRepresentation } from "@/lib/representations/feedstock-types";

export function supplierEtag(row: Pick<SupplierRepresentation, "version">): string {
  return representationEtag(row.version, SUPPLIER_REPRESENTATION_REVISION);
}

export function vehicleEtag(row: Pick<VehicleRepresentation, "version">): string {
  return representationEtag(row.version, VEHICLE_REPRESENTATION_REVISION);
}

export function facilityEtag(row: Pick<FacilityRepresentation, "version">): string {
  return representationEtag(row.version, FACILITY_REPRESENTATION_REVISION);
}

export function storageLocationEtag(row: Pick<StorageLocationRepresentation, "version">): string {
  return representationEtag(row.version, STORAGE_LOCATION_REPRESENTATION_REVISION);
}

export function feedstockEtag(row: Pick<FeedstockRepresentation, "version">): string {
  return representationEtag(row.version, FEEDSTOCK_REPRESENTATION_REVISION);
}

export function driverEtag(row: Pick<DriverRepresentation, "version">): string {
  return representationEtag(row.version, DRIVER_REPRESENTATION_REVISION);
}

export function feedstockTypeEtag(row: Pick<FeedstockTypeRepresentation, "version">): string {
  return representationEtag(row.version, FEEDSTOCK_TYPE_REPRESENTATION_REVISION);
}

export function productionRunEtag(row: { version: number }): string {
  return representationEtag(row.version, PRODUCTION_RUN_REPRESENTATION_REVISION);
}
export function reactorEtag(row: { version: number }): string {
  return representationEtag(row.version, REACTOR_REPRESENTATION_REVISION);
}
