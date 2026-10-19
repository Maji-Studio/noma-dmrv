export const EVAL_PORT = 3199;
export const READY_TIMEOUT_MS = 120_000;
export const READY_POLL_MS = 500;
export const HTTP_TIMEOUT_MS = 5000;
export const CASE_TIMEOUT_MS = 180_000;
export const STOP_GRACE_MS = 3000;
export const TOOL_CALL_BUDGET = 10;
export const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
export const MILLISECONDS_PER_SECOND = 1000;
export const MODEL_FLAG = "--model";
export const MCP_CONFIG_PLACEHOLDER = "{mcp-config}";
export const FACILITY_TIME_ZONE = "Africa/Dar_es_Salaam";
export const EXPECTED_WET_MASS_KG = 4200;
export const EXPECTED_MOISTURE_PERCENT = 32;
export const EXPECTED_DRAW_WET_MASS_KG = 1500;
export const TARGET_REACTOR_CODE = "R1";
export const BIN_CODES = ["B1", "B2", "B3"] as const;
export const TARGET_BIN_CODE = "B2";
export const CASES = [
  { id: "complete-request", text: "log 4.2 t wet wood chips at 32% moisture from supplier X into bin B2" },
  { id: "missing-moisture", text: "log 4.2 t wet wood chips from supplier X into bin B2" },
  { id: "chained-mass-omitted", text: "log 4.2 t wet wood chips from supplier X into bin B2 at 32% moisture, then start a run on R1 with that feedstock" },
  { id: "chained-complete", text: "log 4.2 t wet wood chips from supplier X into bin B2 at 32% moisture, then start a run on R1 with that feedstock, drawing 1.5 t wet from B2" },
] as const;

export const LAB_TOOL_CALL_BUDGET = 8;
export const LAB_BATCH_CODE = "CB-X";
export const LAB_DURABILITY_OPTION = "200_year";
export const LAB_BATCH_WINDOW_DAYS = 30;
export const LAB_SAMPLING_LOCAL_TIME = "10:00";
/** Stored `real` columns round-trip through float32, so percents compare within this. */
export const LAB_VALUE_TOLERANCE = 1e-4;
export const LAB_RATIO_TOLERANCE = 1e-6;
/** Dry-basis results for three replicates of one batch. Organic carbon is distinct per replicate, so rows pair up by it. */
export const LAB_REPLICATES = [
  { totalCarbonPercent: 82.4, organicCarbonPercent: 78.1, hydrogenPercent: 2.1, oxygenPercent: 6.3, ashPercent: 8.5, moisturePercent: 4.2 },
  { totalCarbonPercent: 81.7, organicCarbonPercent: 77.6, hydrogenPercent: 2.3, oxygenPercent: 6.8, ashPercent: 9.1, moisturePercent: 4.6 },
  { totalCarbonPercent: 83.1, organicCarbonPercent: 79, hydrogenPercent: 2, oxygenPercent: 5.9, ashPercent: 8.2, moisturePercent: 3.9 },
] as const;
/** A replicate that leaves out organic carbon. */
export const LAB_INCOMPLETE_REPLICATE = { totalCarbonPercent: 81.2, hydrogenPercent: 2, moisturePercent: 4.5 } as const;
const REPLICATE_TEXT = LAB_REPLICATES.map((r, index) => `Replicate ${index + 1}: total carbon ${r.totalCarbonPercent}%, organic carbon ${r.organicCarbonPercent}%, hydrogen ${r.hydrogenPercent}%, oxygen ${r.oxygenPercent}%, ash ${r.ashPercent}%, moisture ${r.moisturePercent}%.`).join(" ");
export const LAB_CASES = [
  { id: "lab-complete", text: `log the lab results for credit batch ${LAB_BATCH_CODE}, sampled yesterday at ${LAB_SAMPLING_LOCAL_TIME}. Three replicates, all dry basis. ${REPLICATE_TEXT}` },
  { id: "lab-missing-organic", text: `log a lab sample for credit batch ${LAB_BATCH_CODE}, taken yesterday at ${LAB_SAMPLING_LOCAL_TIME}: total carbon ${LAB_INCOMPLETE_REPLICATE.totalCarbonPercent}%, hydrogen ${LAB_INCOMPLETE_REPLICATE.hydrogenPercent}%, moisture ${LAB_INCOMPLETE_REPLICATE.moisturePercent}%, dry basis` },
] as const;

export const STOCK_BIN_CODE = "OB-2";
export const STOCK_TARGET_RUN_CODE = "PR-12";
export const STOCK_LOSS_WET_KG = 200;
/** Target the newer layer so FIFO or choosing the first row cannot pass. */
export const STOCK_RUNS = [
  { code: "PR-11", start: "2026-09-09T08:00:00Z", end: "2026-09-09T12:00:00Z", wetKg: 1000, moisturePercent: 10, dryKg: 900 },
  { code: STOCK_TARGET_RUN_CODE, start: "2026-09-11T08:00:00Z", end: "2026-09-11T12:00:00Z", wetKg: 750, moisturePercent: 20, dryKg: 600 },
] as const;
export const STOCK_CASES = [
  { id: "stock-named-sub-bin-loss", text: `We lost ${STOCK_LOSS_WET_KG} kg wet from run ${STOCK_TARGET_RUN_CODE}'s sub-bin in bin ${STOCK_BIN_CODE}. Record the loss.` },
] as const;

export const DELIVERY_TOOL_CALL_BUDGET = 10;
export const DELIVERY_ORDER_CODE = "OR-X";
export const DELIVERY_BIN_CODE = "PB-1";
export const DELIVERY_SPLIT_BIN_CODE = "PB-2";
export const DELIVERY_WET_MASS_T = 2.4;
export const DELIVERY_WET_MASS_KG = 2400;
export const DELIVERY_MOISTURE_PERCENT = 31;
export const DELIVERY_LOCAL_TIME = "14:00";
interface DeliveryPromptCodes { orderCode: string; binCode: string }
const deliveryRequest = ({ orderCode, binCode }: DeliveryPromptCodes) =>
  `Deliver ${DELIVERY_WET_MASS_T} t wet of order ${orderCode} from ${binCode}`;
export const DELIVERY_CASES = [
  { id: "delivery-complete", text: (codes: DeliveryPromptCodes) => `${deliveryRequest(codes)} at ${DELIVERY_MOISTURE_PERCENT}% moisture, yesterday ${DELIVERY_LOCAL_TIME}` },
  { id: "delivery-missing-moisture", text: (codes: DeliveryPromptCodes) => `${deliveryRequest(codes)}, today ${DELIVERY_LOCAL_TIME}` },
  { id: "delivery-split-bin", text: (codes: DeliveryPromptCodes) => `${deliveryRequest(codes)}, today ${DELIVERY_LOCAL_TIME}` },
] as const;
export type DeliveryCaseId = typeof DELIVERY_CASES[number]["id"];

export const DOCUMENT_TOOL_CALL_BUDGET = 6;
export const DOCUMENT_DELIVERY_CODE = "DL-X";
export const DOCUMENT_CASES = [
  { id: "delivery-bol-upload", text: ({ filePath, deliveryCode }: { filePath: string; deliveryCode: string }) =>
    `Attach the bill of lading at ${filePath} to delivery ${deliveryCode}.` },
] as const;

/** Shared flags are exported so the supervisor can adjust the harness. */
export const CLAUDE_FLAGS = [
  "--mcp-config", MCP_CONFIG_PLACEHOLDER, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__noma",
  "--permission-mode", "dontAsk", "--output-format", "stream-json", "--verbose",
  "--no-session-persistence",
];

/** Only the upload case needs the local shell to hash the file and PUT it. */
export function claudeFlags(caseId: string, fileDirectory?: string): string[] {
  const flags = [...CLAUDE_FLAGS];
  if (caseId === "delivery-bol-upload") {
    flags[flags.indexOf("--tools") + 1] = "Bash";
    flags[flags.indexOf("--allowedTools") + 1] = "mcp__noma,Bash";
    if (fileDirectory) flags.push("--add-dir", fileDirectory);
  }
  return flags;
}

export const APPLICATION_TOOL_CALL_BUDGET = 8;
export const APPLICATION_SCOPES = ["applications:read", "applications:write", "deliveries:read"];
export const APPLICATION_CASES = [
  { id: "application-complete", text: ({ deliveryCode }: { deliveryCode: string }) =>
    `Applied 1.2 t of ${deliveryCode} yesterday on 3 ha, field North, maize.` },
  { id: "application-missing-field-size", text: ({ deliveryCode }: { deliveryCode: string }) =>
    `Applied 1.2 t of ${deliveryCode} yesterday, field North, maize.` },
  { id: "application-over-capacity", text: ({ deliveryCode }: { deliveryCode: string }) =>
    `Applied 1.2 t of ${deliveryCode} yesterday on 3 ha, field South, maize.` },
] as const;
export type ApplicationCaseId = typeof APPLICATION_CASES[number]["id"];

const FORMULATION_CREATE_BUDGET = 5;
const FORMULATION_COMMAND_BUDGET = 4;
const FORMULATION_ARCHIVED_BUDGET = 8;
const FORMULATION_PRODUCT_SCOPES = ["biochar-products:write", "biochar-products:read", "storage-locations:read",
  "facilities:read", "production-runs:read", "formulations:read"];
const FORMULATION_CREATE_SCOPES = ["formulations:write", "feedstock-types:read"];
const FORMULATION_COMMAND_SCOPES = ["formulations:read", "formulations:write"];
export const FORMULATION_CASES = [
  { id: "formulation-blend", budget: FORMULATION_CREATE_BUDGET, scopes: FORMULATION_CREATE_SCOPES,
    text: () => "Add a formulation called Compost blend: 70% biochar and 30% compost." },
  { id: "formulation-unknown-ingredient", budget: FORMULATION_CREATE_BUDGET, scopes: FORMULATION_CREATE_SCOPES,
    text: () => "Add a formulation called Compost blend: 70% biochar and 30% rock dust." },
  { id: "formulation-guarded-delete", budget: FORMULATION_COMMAND_BUDGET, scopes: ["formulations:read", "formulations:delete"],
    text: ({ code }: { code: string }) => `Delete the formulation ${code}.` },
  { id: "formulation-archive", budget: FORMULATION_COMMAND_BUDGET, scopes: FORMULATION_COMMAND_SCOPES,
    text: ({ code }: { code: string }) => `Archive formulation ${code}.` },
  { id: "formulation-archived", budget: FORMULATION_ARCHIVED_BUDGET, scopes: FORMULATION_PRODUCT_SCOPES,
    text: ({ name }: { name: string }) => `Make 500 kg of product with ${name}.` },
  { id: "formulation-restore", budget: FORMULATION_COMMAND_BUDGET, scopes: FORMULATION_COMMAND_SCOPES,
    text: ({ code }: { code: string }) => `We use ${code} again.` },
] as const;
export type FormulationCaseId = typeof FORMULATION_CASES[number]["id"];

const PARTY_CREATE_BUDGET = 6;
const PARTY_LOOKUP_BUDGET = 4;
const PARTY_ARCHIVED_ADD_BUDGET = 6;
// Minimum path: whoami, active supplier, feedstock type, archived supplier, bin, dry-run intake (six calls).
const PARTY_ARCHIVED_INTAKE_BUDGET = 8;
const PARTY_RESTORE_BUDGET = 5;
const PARTY_LOCATION_WRITE_BUDGET = 5;
const PARTY_LOCATION_READ_BUDGET = 4;
// Find customer, find location, refused delete, optional order lookup, plus margin.
const PARTY_LOCATION_REFUSAL_BUDGET = 6;
const SUPPLIER_COMMAND_SCOPES = ["suppliers:read", "suppliers:write"];
export const PARTY_PICKUP = { gpsLatitude: -8.12, gpsLongitude: 36.45, distanceKm: 42 };
export const PARTY_FIELD = { gpsLatitude: -8.90, gpsLongitude: 33.40, name: "North Block" };
export const PARTY_SUPPLIER_NAME = "Kilombero Sawmill";
export const PARTY_CUSTOMER_NAME = "Mbeya Coffee Estate";
interface PartyPromptTarget { name: string; facilityName: string }
export const PARTY_LOCATION_CITY = "Morogoro";
export const PARTY_SOIL_TEMPERATURE_C = 23.5;
export const PARTY_ORDER_CODE = "ORD-0005";
export const PARTY_CASES = [
  { id: "supplier-location-update", budget: PARTY_LOCATION_WRITE_BUDGET, scopes: SUPPLIER_COMMAND_SCOPES,
    text: () => `Change the city of ${PARTY_SUPPLIER_NAME}’s Existing pickup to ${PARTY_LOCATION_CITY}. Keep everything else.` },
  { id: "customer-field-missing-gps", budget: PARTY_LOCATION_READ_BUDGET, scopes: ["customers:read", "customers:write"],
    text: () => `Add a field called East Block to ${PARTY_CUSTOMER_NAME} in Tanzania.` },
  { id: "customer-location-archive", budget: PARTY_LOCATION_WRITE_BUDGET, scopes: ["customers:read", "customers:write"],
    text: () => "North Block no longer receives biochar. Archive it." },
  { id: "customer-location-in-use", budget: PARTY_LOCATION_REFUSAL_BUDGET, scopes: ["customers:read", "customers:delete", "orders:read"],
    text: () => "Delete the field North Block." },
  { id: "order-archived-destination", budget: PARTY_LOCATION_READ_BUDGET, scopes: ["orders:read", "customers:read"],
    text: () => `Which field does order ${PARTY_ORDER_CODE} go to, and what is its default soil temperature?` },
  { id: "supplier-with-pickup", budget: PARTY_CREATE_BUDGET, scopes: ["suppliers:read", "suppliers:write", "facilities:read"],
    text: ({ facilityName }: PartyPromptTarget) => `Add supplier ${PARTY_SUPPLIER_NAME} with a pickup location at -8.12, 36.45 in Tanzania, 42 km by road from ${facilityName}.` },
  { id: "customer-and-field", budget: PARTY_CREATE_BUDGET, scopes: ["customers:read", "customers:write"],
    text: () => `Record a new customer, ${PARTY_CUSTOMER_NAME}, with a field called North Block at -8.90, 33.40 in Tanzania.` },
  { id: "supplier-already-exists", budget: PARTY_LOOKUP_BUDGET, scopes: ["suppliers:read", "suppliers:write"],
    text: ({ name }: PartyPromptTarget) => `Add supplier ${name}.` },
  { id: "supplier-already-exists-archived", budget: PARTY_ARCHIVED_ADD_BUDGET, scopes: SUPPLIER_COMMAND_SCOPES,
    text: ({ name }: PartyPromptTarget) => `Add supplier ${name}.` },
  { id: "supplier-archived-intake", budget: PARTY_ARCHIVED_INTAKE_BUDGET, scopes: ["suppliers:read", "feedstocks:write", "feedstock-types:read", "facilities:read", "storage-locations:read"],
    text: ({ name }: PartyPromptTarget) => `Log 2 t of rice husk from ${name} today at 30% moisture.` },
  { id: "supplier-restore", budget: PARTY_RESTORE_BUDGET, scopes: SUPPLIER_COMMAND_SCOPES,
    text: () => `We buy from ${PARTY_SUPPLIER_NAME} again.` },
  { id: "customer-restore", budget: PARTY_RESTORE_BUDGET, scopes: ["customers:read", "customers:write"],
    text: () => `We sell to ${PARTY_CUSTOMER_NAME} again.` },
] as const;
export type PartyCaseId = typeof PARTY_CASES[number]["id"];
// customer-stale-version is deferred: runClaude has no between-read-and-write hook.
