import { readProductionRunListFromInput, readProductionRun } from "@/lib/api/production-runs-queries";
import { readReactorListFromInput } from "@/lib/api/reactors-queries";
import { productionRunRepresentationSchema } from "@/lib/representations/production-runs";
import { PRODUCTION_RUN_GUIDANCE } from "@/lib/operations/agent-guidance";
import { z } from "zod";
import { uuidSchema } from "@/schemas/helpers";
import type { ApiContext } from "@/lib/auth/api-context";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { resources } from "@/lib/api/openapi/resources";
import { outputStockMovementListSchema, resourceQueries, supplierLocationListSchema } from "@/lib/api/query-schemas";
import { readFacilityListFromInput } from "@/lib/api/facilities-queries";
import { readSupplierListFromInput } from "@/lib/api/suppliers-queries";
import { readSupplierLocationListFromInput } from "@/lib/api/supplier-locations-queries";
import { readFeedstockTypeListFromInput } from "@/lib/api/feedstock-types-queries";
import { readStorageLocationListFromInput } from "@/lib/api/storage-locations-queries";
import { readVehicleListFromInput } from "@/lib/api/vehicles-queries";
import { readDriverListFromInput } from "@/lib/api/drivers-queries";
import { readFeedstockListFromInput, readFeedstock } from "@/lib/api/feedstock-queries";
import { readBiocharProductListFromInput, readBiocharProduct } from "@/lib/api/biochar-products-queries";
import { readFormulationListFromInput } from "@/lib/api/formulations-queries";
import { readOutputStockMovementListFromInput } from "@/lib/api/output-stock-movements-queries";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import { outputStockMovementRepresentationSchema } from "@/lib/representations/output-stock-movements";
import { readApiMe } from "@/lib/read-models/api-me";
import { itemEnvelopeSchema, listEnvelopeSchema } from "@/lib/representations/envelopes";
import { meRepresentationSchema } from "@/lib/representations/me";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import { parseQueryInput } from "@/lib/api/query";
import { UNTRUSTED_TEXT, FEEDSTOCK_UNITS, FEEDSTOCK_DATES, BIOCHAR_PRODUCT_MASS } from "@/lib/operations/agent-guidance";

type ResourcePath = keyof typeof resourceQueries;

const labels: Record<ResourcePath, { singular: string; plural: string }> = {
  "production-runs": { singular: "production run", plural: "production runs" },
  reactors: { singular: "reactor", plural: "reactors" },
  "facilities": { singular: "facility", plural: "facilities" },
  "suppliers": { singular: "supplier", plural: "suppliers" },
  "feedstock-types": { singular: "feedstock type", plural: "feedstock types" },
  "storage-locations": { singular: "storage location", plural: "storage locations" },
  "vehicles": { singular: "vehicle", plural: "vehicles" },
  "drivers": { singular: "driver", plural: "drivers" },
  "feedstocks": { singular: "feedstock", plural: "feedstocks" },
  "biochar-products": { singular: "biochar product", plural: "biochar products" },
  formulations: { singular: "formulation", plural: "formulations" },
};
const guidance: Record<ResourcePath, string> = {
  "production-runs": PRODUCTION_RUN_GUIDANCE,
  reactors: "Call whoami first for the run facility. Use the reactor UUID with start_production_run.",
  facilities: "Call whoami first for the credential's active facilities and local dates.",
  suppliers: "Use the supplier id with find_supplier_locations.",
  "feedstock-types": "Use the feedstock type id to identify the delivered material.",
  "storage-locations": "Call whoami first for a facility id to pass as facilityId. Capacity is in kilograms.",
  vehicles: "Use the vehicle id to identify the intake vehicle.",
  drivers: "Use the driver id to identify the driver.",
  feedstocks: `Call whoami first for facility ids. ${FEEDSTOCK_UNITS} ${FEEDSTOCK_DATES}`,
  "biochar-products": `Call whoami first for facility ids. Filter by facilityId, formulationId, status or storageLocationId. ${BIOCHAR_PRODUCT_MASS}`,
  formulations: "Each formulation lists its lines as { id, feedstockTypeId, ratio }. Pass a line id as formulationIngredientId in make_biochar_product.",
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

/** Pairs each resource's list schema with its own reader, so the parsed input is checked against that reader's filters. */
function findTool<K extends ResourcePath, S extends z.ZodType>(path: K, list: S, read: (ctx: ApiContext, input: z.output<S>) => Promise<Record<string, unknown>>): ReadTool {
  const resource = resources.find((candidate) => candidate.path === path)!;
  return defineRead({
    name: `find_${path.replaceAll("-", "_")}`, scope: resource.scope,
    summarize: listSummary(labels[path].singular, labels[path].plural),
    description: `${readDescriptions.list} ${guidance[path]}`,
    input: list, output: listEnvelopeSchema(resource.schema),
  }, read);
}

export const readTools: ReadTool[] = [
  defineRead({ name: "get_production_run", scope: "production-runs:read",
    summarize: (body) => { const row = body.data as { code: string; version: number }; return `Production run ${row.code}, version ${row.version}.`; },
    description: `${readDescriptions.get} Call find_production_runs first for an id or code. ${PRODUCTION_RUN_GUIDANCE}`,
    input: resourceQueries["production-runs"].get.extend({ idOrCode: z.string().describe("Production run UUID or exact code.") }),
    output: itemEnvelopeSchema(productionRunRepresentationSchema),
  }, async (ctx, { idOrCode }) => ({ data: await readProductionRun(ctx, idOrCode) })),
  defineRead({ name: "whoami", summarize: (body) => {
    const data = body.data as z.infer<typeof meRepresentationSchema>;
    return `Organization ${data.organization.name}, ${data.facilities.length} ${data.facilities.length === 1 ? "facility" : "facilities"}, role ${data.role}.`;
  }, description: `${readDescriptions.whoami} Call this first for facility ids, time zones, today and localTime for the facility clock.`, input: z.strictObject({}), output: itemEnvelopeSchema(meRepresentationSchema) },
    async (ctx) => ({ data: await readApiMe(ctx) })),
  findTool("production-runs", resourceQueries["production-runs"].list, readProductionRunListFromInput),
  findTool("reactors", resourceQueries["reactors"].list, readReactorListFromInput),
  findTool("feedstocks", resourceQueries["feedstocks"].list, readFeedstockListFromInput),
  findTool("facilities", resourceQueries["facilities"].list, readFacilityListFromInput),
  findTool("suppliers", resourceQueries["suppliers"].list, readSupplierListFromInput),
  findTool("feedstock-types", resourceQueries["feedstock-types"].list, readFeedstockTypeListFromInput),
  findTool("storage-locations", resourceQueries["storage-locations"].list, readStorageLocationListFromInput),
  findTool("vehicles", resourceQueries["vehicles"].list, readVehicleListFromInput),
  findTool("drivers", resourceQueries["drivers"].list, readDriverListFromInput),
  findTool("biochar-products", resourceQueries["biochar-products"].list, readBiocharProductListFromInput),
  findTool("formulations", resourceQueries["formulations"].list, readFormulationListFromInput),
  defineRead({ name: "find_supplier_locations", summarize: listSummary("supplier location", "supplier locations"), scope: "suppliers:read",
    description: `${readDescriptions.supplierLocations} Call find_suppliers first for the supplier UUID in supplierId. Coordinates are WGS 84 decimal degrees.`,
    input: supplierLocationListSchema.extend({ supplierId: uuidSchema().describe("Supplier identifier, UUID, from find_suppliers.") }),
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
  defineRead({ name: "get_biochar_product", summarize: (body) => {
    const data = body.data as z.infer<typeof biocharProductRepresentationSchema>;
    return `Biochar product ${data.code}, version ${data.version}.`;
  }, scope: "biochar-products:read",
    description: `${readDescriptions.get} Call find_biochar_products first for an id or code. Pass version as expectedVersion to update_biochar_product. ${BIOCHAR_PRODUCT_MASS}`,
    input: resourceQueries["biochar-products"].get.extend({ idOrCode: z.string().describe("Biochar product UUID or exact code.") }),
    output: itemEnvelopeSchema(biocharProductRepresentationSchema),
  }, async (ctx, { idOrCode }) => ({ data: await readBiocharProduct(ctx, idOrCode) })),
  defineRead({ name: "find_output_stock_movements", summarize: listSummary("stock movement", "stock movements"), scope: "biochar-products:read",
    description: `${readDescriptions.outputStockMovements} Call find_storage_locations first for the bin id or code in idOrCode.`,
    input: outputStockMovementListSchema.extend({ idOrCode: z.string().describe("Biochar or product bin UUID or exact code, from find_storage_locations.") }),
    output: listEnvelopeSchema(outputStockMovementRepresentationSchema, "newest posting first"),
  }, (ctx, { idOrCode, ...input }) => readOutputStockMovementListFromInput(ctx, input, idOrCode)),
];
