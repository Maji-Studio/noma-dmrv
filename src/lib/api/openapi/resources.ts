import { productionRunRepresentationSchema } from "@/lib/representations/production-runs";
import { reactorRepresentationSchema } from "@/lib/representations/reactors";
import { facilityRepresentationSchema } from "@/lib/representations/facilities";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { feedstockTypeRepresentationSchema } from "@/lib/representations/feedstock-types";
import { storageLocationRepresentationSchema } from "@/lib/representations/storage-locations";
import { vehicleRepresentationSchema } from "@/lib/representations/vehicles";
import { driverRepresentationSchema } from "@/lib/representations/drivers";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import { formulationRepresentationSchema } from "@/lib/representations/formulations";
import { resourceQueries } from "../query-schemas";
import type { ApiScope } from "@/lib/auth/api-scopes";

/** Route-specific seams without importing handlers or their database dependencies. */
export const resources = ([
  { path: "production-runs", singular: "production_run", schema: productionRunRepresentationSchema },
  { path: "reactors", singular: "reactor", schema: reactorRepresentationSchema },
  { path: "feedstocks", singular: "feedstock", schema: feedstockRepresentationSchema },
  { path: "facilities", singular: "facility", schema: facilityRepresentationSchema },
  { path: "suppliers", singular: "supplier", schema: supplierRepresentationSchema },
  { path: "feedstock-types", singular: "feedstock_type", schema: feedstockTypeRepresentationSchema },
  { path: "storage-locations", singular: "storage_location", schema: storageLocationRepresentationSchema },
  { path: "vehicles", singular: "vehicle", schema: vehicleRepresentationSchema },
  { path: "drivers", singular: "driver", schema: driverRepresentationSchema },
] as const).map((resource) => ({ ...resource, queries: resourceQueries[resource.path], scope: `${resource.path}:read` as ApiScope }));

/**
 * Resources served over REST whose MCP find and get tools arrive with the MCP
 * commit; the OpenAPI document publishes both lists.
 */
export const restResources = ([
  { path: "biochar-products", singular: "biochar_product", schema: biocharProductRepresentationSchema },
  { path: "formulations", singular: "formulation", schema: formulationRepresentationSchema },
] as const).map((resource) => ({ ...resource, queries: resourceQueries[resource.path], scope: `${resource.path}:read` as ApiScope }));
