/**
 * Server-only read orchestration over `data-access/`. Each core validates its
 * input, enforces facility scope, and returns domain data for a caller-supplied
 * `OrgContext`. Authentication belongs to the caller: a `fn/` Server Action
 * wrapper (`withAction`) or the `/api/reads/*` HTTP adapter. See
 * docs/architecture.md, "Authenticated read transport".
 */
export {
  readProductionRuns,
  readProductionRunStats,
} from "./production-runs";
export { readFacilities } from "./facilities";
export { readCreditBatches } from "./credit-batches";
export {
  readFacilityCertifierSummary,
  type FacilityCertifierSummary,
} from "./facility-certifier-summary";
