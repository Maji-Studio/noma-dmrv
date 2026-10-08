import { facilityRepresentationSchema } from "../representations/facilities";
import { supplierRepresentationSchema } from "../representations/suppliers";
import { feedstockTypeRepresentationSchema } from "../representations/feedstock-types";
import { storageLocationRepresentationSchema } from "../representations/storage-locations";
import { vehicleRepresentationSchema } from "../representations/vehicles";
import { driverRepresentationSchema } from "../representations/drivers";
import { feedstockRepresentationSchema } from "../representations/feedstocks";
import { lookupListSchema, lookupGetSchema, facilityLookupListSchema, facilityLookupGetSchema, feedstockListSchema } from "../query-schemas";
import type { ApiScope } from "@/lib/auth/api-scopes";

/** Route-specific seams without importing handlers or their database dependencies. */
export const resources = [
  { path: "feedstocks", singular: "feedstock", schema: feedstockRepresentationSchema, listQuery: feedstockListSchema, getQuery: lookupGetSchema, etag: true },
  { path: "facilities", singular: "facility", schema: facilityRepresentationSchema, listQuery: lookupListSchema, getQuery: lookupGetSchema, etag: true },
  { path: "suppliers", singular: "supplier", schema: supplierRepresentationSchema, listQuery: lookupListSchema, getQuery: lookupGetSchema, etag: true },
  { path: "feedstock-types", singular: "feedstock_type", schema: feedstockTypeRepresentationSchema, listQuery: lookupListSchema, getQuery: lookupGetSchema, etag: true },
  { path: "storage-locations", singular: "storage_location", schema: storageLocationRepresentationSchema, listQuery: facilityLookupListSchema, getQuery: facilityLookupGetSchema, etag: true },
  { path: "vehicles", singular: "vehicle", schema: vehicleRepresentationSchema, listQuery: lookupListSchema, getQuery: lookupGetSchema, etag: false },
  { path: "drivers", singular: "driver", schema: driverRepresentationSchema, listQuery: lookupListSchema, getQuery: lookupGetSchema, etag: false },
].map((resource) => ({ ...resource, scope: `${resource.path}:read` as ApiScope }));
