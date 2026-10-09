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
export const BIN_CODES = ["B1", "B2", "B3"] as const;
export const TARGET_BIN_CODE = "B2";
export const CASES = [
  { id: "complete-request", text: "log 4.2 t wet wood chips at 32% moisture from supplier X into bin B2" },
  { id: "missing-moisture", text: "log 4.2 t wet wood chips from supplier X into bin B2" },
] as const;

/** Shared flags are exported so the supervisor can adjust the harness. */
export const CLAUDE_FLAGS = [
  "--mcp-config", MCP_CONFIG_PLACEHOLDER, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__noma",
  "--permission-mode", "dontAsk", "--output-format", "stream-json", "--verbose",
  "--no-session-persistence",
];
