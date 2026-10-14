import { readProductionRunListFromInput, readProductionRun } from "@/lib/api/production-runs-queries";
import { readReactorListFromInput } from "@/lib/api/reactors-queries";
import { productionRunRepresentationSchema } from "@/lib/representations/production-runs";
import { PRODUCTION_RUN_GUIDANCE } from "@/lib/operations/agent-guidance";
import { z } from "zod";
import { uuidSchema } from "@/schemas/helpers";
import type { ApiContext } from "@/lib/auth/api-context";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { resources } from "@/lib/api/openapi/resources";
import { outputStockMovementListSchema, resourceQueries, supplierLocationListSchema, customerLocationListSchema } from "@/lib/api/query-schemas";
import { readFacilityListFromInput } from "@/lib/api/facilities-queries";
import { readSupplierListFromInput } from "@/lib/api/suppliers-queries";
import { readSupplierLocationListFromInput } from "@/lib/api/supplier-locations-queries";
import { readFeedstockTypeListFromInput } from "@/lib/api/feedstock-types-queries";
import { readStorageLocationListFromInput } from "@/lib/api/storage-locations-queries";
import { readVehicleListFromInput } from "@/lib/api/vehicles-queries";
import { readDriverListFromInput } from "@/lib/api/drivers-queries";
import { readFeedstockListFromInput, readFeedstock } from "@/lib/api/feedstock-queries";
import { readBiocharProductListFromInput, readBiocharProduct } from "@/lib/api/biochar-products-queries";
import { readLabSampleListFromInput, readLabSample } from "@/lib/api/lab-samples-queries";
import { readCreditBatchListFromInput } from "@/lib/api/credit-batches-queries";
import { labSampleRepresentationSchema } from "@/lib/representations/lab-samples";
import { readFormulationListFromInput } from "@/lib/api/formulations-queries";
import { readOutputStockMovementListFromInput } from "@/lib/api/output-stock-movements-queries";
import { readOutputBinStockFromInput } from "@/lib/api/output-bin-stock-queries";
import { outputBinStockRepresentationSchema } from "@/lib/representations/output-bin-stock";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import { outputStockMovementRepresentationSchema } from "@/lib/representations/output-stock-movements";
import { readApiMe } from "@/lib/read-models/api-me";
import { itemEnvelopeSchema, listEnvelopeSchema } from "@/lib/representations/envelopes";
import { meRepresentationSchema } from "@/lib/representations/me";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import { parseQueryInput } from "@/lib/api/query";
import { UNTRUSTED_TEXT, LAB_SAMPLE_TIMES, LAB_SAMPLE_UNITS, FEEDSTOCK_UNITS, FEEDSTOCK_DATES, BIOCHAR_PRODUCT_MASS, ORDER_GUIDANCE } from "@/lib/operations/agent-guidance";
import { readCustomerListFromInput } from "@/lib/api/customers-queries";
import { readCustomerLocationListFromInput } from "@/lib/api/customer-locations-queries";
import { readOrderListFromInput } from "@/lib/api/orders-queries";
import { readOrderBalanceFromInput } from "@/lib/api/order-balance-queries";
import { readApiOrder } from "@/lib/read-models/api-orders";
import { lookupIdentifier } from "@/lib/api/lookup-query";
import { orderRepresentationSchema } from "@/lib/representations/orders";
import { orderBalanceRepresentationSchema } from "@/lib/representations/order-balance";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";

type ResourcePath = keyof typeof resourceQueries;

const labels: Record<ResourcePath, { singular: string; plural: string }> = {
  "production-runs": { singular: "production run", plural: "production runs" },
  customers: { singular: "customer", plural: "customers" },
  orders: { singular: "order", plural: "orders" },
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
  "lab-samples": { singular: "lab sample", plural: "lab samples" },
  "credit-batches": { singular: "credit batch", plural: "credit batches" },
};
const guidance: Record<ResourcePath, string> = {
  "production-runs": PRODUCTION_RUN_GUIDANCE,
  customers: `${readDescriptions.customers} Use the customer id or code with find_customer_locations.`,
  orders: `${readDescriptions.orders} Call whoami for facility ids. ${ORDER_GUIDANCE}`,
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
  "lab-samples": `Filter by creditBatchId or facilityId; sampledFrom and sampledBefore take RFC 3339 instants with an explicit offset. Samples of archived credit batches are not listed. ${LAB_SAMPLE_UNITS}`,
  "credit-batches": "Call whoami first for facility ids. A lab sample belongs to one credit batch; the batch's facility sets its durability tier and time zone.",
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
  findTool("customers", resourceQueries.customers.list, readCustomerListFromInput),
  findTool("orders", resourceQueries.orders.list, readOrderListFromInput),
  defineRead({ name: "find_customer_locations", scope: "customers:read",
    summarize: listSummary("customer location", "customer locations"),
    description: `${readDescriptions.customerLocations} Call find_customers first for the customer UUID or exact code in idOrCode. Coordinates are WGS 84 decimal degrees.`,
    input: customerLocationListSchema.extend({ idOrCode: z.string().describe("Customer UUID or exact code, from find_customers.") }),
    output: listEnvelopeSchema(customerLocationRepresentationSchema),
  }, (ctx, { idOrCode, ...input }) => readCustomerLocationListFromInput(ctx, input, idOrCode)),
  defineRead({ name: "get_order", scope: "orders:read",
    summarize: (body) => { const row = body.data as z.infer<typeof orderRepresentationSchema>; return `Order ${row.code}, version ${row.version}.`; },
    description: `${readDescriptions.get} Call find_orders first for an id or code. Pass version as expectedVersion to update_order or delete_order. ${ORDER_GUIDANCE}`,
    input: resourceQueries.orders.get.extend({ idOrCode: z.string().describe("Order UUID or exact code.") }),
    output: itemEnvelopeSchema(orderRepresentationSchema),
  }, async (ctx, { idOrCode }) => ({ data: await readApiOrder(ctx, lookupIdentifier(idOrCode)) })),
  defineRead({ name: "get_order_balance", scope: "orders:read",
    summarize: (body) => { const row = body.data as z.infer<typeof orderBalanceRepresentationSchema>; return `Order balance: ${row.remainingWetMassKg} wet kg remaining (${row.fulfillmentStatus}).`; },
    description: `${readDescriptions.orderBalance} Call find_orders first for an id or code. Call it before recording a delivery.`,
    input: resourceQueries.orders.get.extend({ idOrCode: z.string().describe("Order UUID or exact code.") }),
    output: itemEnvelopeSchema(orderBalanceRepresentationSchema),
  }, (ctx, { idOrCode }) => readOrderBalanceFromInput(ctx, idOrCode)),
  defineRead({ name: "get_bin_stock", scope: "biochar-products:read",
    summarize: (body) => {
      const data = body.data as z.infer<typeof outputBinStockRepresentationSchema>;
      return data.status === "resolved" ? `Bin ${data.code} stock read.` : `Bin ${data.code} stock is unknown; unresolvedReason says why.`;
    },
    description: `${readDescriptions.outputBinStock} Call find_storage_locations first for storageLocation.`,
    input: resourceQueries["storage-locations"].get.extend({ storageLocation: z.string().describe("Biochar or product bin UUID or exact code, from find_storage_locations.") }),
    output: itemEnvelopeSchema(outputBinStockRepresentationSchema),
  }, (ctx, { storageLocation, ...input }) => readOutputBinStockFromInput(ctx, input, storageLocation)),
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
  findTool("lab-samples", resourceQueries["lab-samples"].list, readLabSampleListFromInput),
  findTool("credit-batches", resourceQueries["credit-batches"].list, readCreditBatchListFromInput),
  defineRead({ name: "get_lab_sample", summarize: (body) => {
    const data = body.data as z.infer<typeof labSampleRepresentationSchema>;
    return `Lab sample ${data.code}, version ${data.version}.`;
  }, scope: "lab-samples:read",
    description: `${readDescriptions.get} Call find_lab_samples first for an id or code. Pass version as expectedVersion to update_lab_sample or delete_lab_sample. ${LAB_SAMPLE_TIMES} ${LAB_SAMPLE_UNITS}`,
    input: resourceQueries["lab-samples"].get.extend({ idOrCode: z.string().describe("Lab sample UUID or exact code.") }),
    output: itemEnvelopeSchema(labSampleRepresentationSchema),
  }, async (ctx, { idOrCode }) => ({ data: await readLabSample(ctx, idOrCode) })),
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
