import { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { resources } from "@/lib/api/openapi/resources";
import { resourceQueries, supplierLocationListSchema } from "@/lib/api/query-schemas";
import { readFacilityListFromInput } from "@/lib/api/facilities-queries";
import { readSupplierListFromInput } from "@/lib/api/suppliers-queries";
import { readSupplierLocationListFromInput } from "@/lib/api/supplier-locations-queries";
import { readFeedstockTypeListFromInput } from "@/lib/api/feedstock-types-queries";
import { readStorageLocationListFromInput } from "@/lib/api/storage-locations-queries";
import { readVehicleListFromInput } from "@/lib/api/vehicles-queries";
import { readDriverListFromInput } from "@/lib/api/drivers-queries";
import { readFeedstockListFromInput, readFeedstock } from "@/lib/api/feedstock-queries";
import { readApiMe } from "@/lib/read-models/api-me";
import { itemEnvelopeSchema, listEnvelopeSchema } from "@/lib/representations/envelopes";
import { meRepresentationSchema } from "@/lib/representations/me";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import { parseQueryInput } from "@/lib/api/query";
import { UNTRUSTED_TEXT, FEEDSTOCK_UNITS, FEEDSTOCK_DATES } from "@/lib/operations/agent-guidance";

const readers = {
  facilities: readFacilityListFromInput, suppliers: readSupplierListFromInput,
  "feedstock-types": readFeedstockTypeListFromInput, "storage-locations": readStorageLocationListFromInput,
  vehicles: readVehicleListFromInput, drivers: readDriverListFromInput, feedstocks: readFeedstockListFromInput,
};
const labels: Record<keyof typeof readers, { singular: string; plural: string }> = {
  "facilities": { singular: "facility", plural: "facilities" },
  "suppliers": { singular: "supplier", plural: "suppliers" },
  "feedstock-types": { singular: "feedstock type", plural: "feedstock types" },
  "storage-locations": { singular: "storage location", plural: "storage locations" },
  "vehicles": { singular: "vehicle", plural: "vehicles" },
  "drivers": { singular: "driver", plural: "drivers" },
  "feedstocks": { singular: "feedstock", plural: "feedstocks" },
};
const guidance: Record<keyof typeof readers, string> = {
  facilities: "Call whoami first for the credential's active facilities and local dates.",
  suppliers: "Use the supplier id with find_supplier_locations.",
  "feedstock-types": "Use the feedstock type id to identify the delivered material.",
  "storage-locations": "Call whoami first for a facility id to pass as facilityId. Capacity is in kilograms.",
  vehicles: "Use the vehicle id to identify the intake vehicle.",
  drivers: "Use the driver id to identify the driver.",
  feedstocks: `Call whoami first for facility ids. ${FEEDSTOCK_UNITS} ${FEEDSTOCK_DATES}`,
};

export interface ReadTool {
  kind: "read";
  name: string;
  summarize: (body: Record<string, unknown>) => string;
  scope?: ApiScope;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  execute: (ctx: ApiContext, raw: unknown) => Promise<Record<string, unknown>>;
}

function listSummary(singular: string, plural: string) {
  return (body: Record<string, unknown>) => {
    const count = (body.data as unknown[]).length;
    return `${count} ${count === 1 ? singular : plural}.${body.nextCursor ? " More results: pass nextCursor." : ""}`;
  };
}

/** The generic closes over each schema so parsed input stays typed at its reader. */
function defineRead<S extends z.ZodType>(
  config: Omit<ReadTool, "kind" | "input" | "execute"> & { input: S },
  read: (ctx: ApiContext, input: z.output<S>) => Promise<Record<string, unknown>>,
): ReadTool {
  return { ...config, kind: "read", description: `${config.description} ${UNTRUSTED_TEXT}`,
    execute: (ctx, raw) => read(ctx, parseQueryInput(raw, config.input)) };
}

export const readTools: ReadTool[] = [
  defineRead({ name: "whoami", summarize: (body) => {
    const data = body.data as z.infer<typeof meRepresentationSchema>;
    return `Organization ${data.organization.name}, ${data.facilities.length} ${data.facilities.length === 1 ? "facility" : "facilities"}, role ${data.role}.`;
  }, description: `${readDescriptions.whoami} Call this first for facility ids, time zones and local YYYY-MM-DD dates.`, input: z.strictObject({}), output: itemEnvelopeSchema(meRepresentationSchema) },
    async (ctx) => ({ data: await readApiMe(ctx) })),
  ...resources.map((resource) => defineRead({
    name: `find_${resource.path.replaceAll("-", "_")}`, scope: resource.scope,
    summarize: listSummary(labels[resource.path].singular, labels[resource.path].plural),
    description: `${readDescriptions.list} ${guidance[resource.path]}`,
    input: resource.queries.list, output: listEnvelopeSchema(resource.schema),
  }, (ctx, input) => readers[resource.path](ctx, input))),
  defineRead({ name: "find_supplier_locations", summarize: listSummary("supplier location", "supplier locations"), scope: "suppliers:read",
    description: `${readDescriptions.supplierLocations} Call find_suppliers first for the supplier UUID in supplierId. Coordinates are WGS 84 decimal degrees.`,
    input: supplierLocationListSchema.extend({ supplierId: z.uuid().describe("Supplier identifier, UUID, from find_suppliers.") }),
    output: listEnvelopeSchema(supplierLocationRepresentationSchema),
  }, (ctx, { supplierId, ...input }) => readSupplierLocationListFromInput(ctx, input, supplierId)),
  defineRead({ name: "get_feedstock", summarize: (body) => {
    const data = body.data as z.infer<typeof feedstockRepresentationSchema>;
    return `Feedstock ${data.code}, version ${data.version}.`;
  }, scope: "feedstocks:read",
    description: `${readDescriptions.get} Call find_feedstocks first for an id or code. ${FEEDSTOCK_UNITS} ${FEEDSTOCK_DATES}`,
    input: resourceQueries.feedstocks.get.extend({ idOrCode: z.string().describe("Resource UUID or exact human-readable code.") }),
    output: itemEnvelopeSchema(feedstockRepresentationSchema),
  }, async (ctx, { idOrCode }) => ({ data: await readFeedstock(ctx, idOrCode) })),
];
