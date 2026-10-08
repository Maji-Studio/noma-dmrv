import { facilityRepresentationSchema } from "../representations/facilities";
import { supplierRepresentationSchema } from "../representations/suppliers";
import { feedstockTypeRepresentationSchema } from "../representations/feedstock-types";
import { storageLocationRepresentationSchema } from "../representations/storage-locations";
import { vehicleRepresentationSchema } from "../representations/vehicles";
import { driverRepresentationSchema } from "../representations/drivers";
import { feedstockRepresentationSchema } from "../representations/feedstocks";
import { resourceQueries } from "../query-schemas";
import type { ApiScope } from "@/lib/auth/api-scopes";

/** Route-specific seams without importing handlers or their database dependencies. */
export const resources = ([
  { path: "feedstocks", singular: "feedstock", schema: feedstockRepresentationSchema },
  { path: "facilities", singular: "facility", schema: facilityRepresentationSchema },
  { path: "suppliers", singular: "supplier", schema: supplierRepresentationSchema },
  { path: "feedstock-types", singular: "feedstock_type", schema: feedstockTypeRepresentationSchema },
  { path: "storage-locations", singular: "storage_location", schema: storageLocationRepresentationSchema },
  { path: "vehicles", singular: "vehicle", schema: vehicleRepresentationSchema },
  { path: "drivers", singular: "driver", schema: driverRepresentationSchema },
] as const).map((resource) => ({ ...resource, queries: resourceQueries[resource.path], scope: `${resource.path}:read` as ApiScope }));
