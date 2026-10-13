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

/** Shared flags are exported so the supervisor can adjust the harness. */
export const CLAUDE_FLAGS = [
  "--mcp-config", MCP_CONFIG_PLACEHOLDER, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__noma",
  "--permission-mode", "dontAsk", "--output-format", "stream-json", "--verbose",
  "--no-session-persistence",
];
