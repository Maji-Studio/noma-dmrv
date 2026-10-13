/**
 * Production Runs Data Access Layer
 * CRUD operations for production runs with auth guards, pagination, and filtering.
 * Includes M:M relationship handling for feedstocks.
 *
 * Split by concern: queries (reads), mutations (create/update/delete), and
 * readings (time-series). This barrel preserves the original public API so
 * `@/data-access/production-runs` keeps resolving here.
 */

export type {
  ProductionRunFeedstockWithDetails,
  ProductionRunWithRelations,
  PaginatedProductionRuns,
  ProductionRunStats,
  ProductionRunReadingRecord,
  ProductionRunWithSamples,
} from "./types";

export {
  getProductionRuns,
  getProductionRunById,
  getProductionRunStats,
  getProductionRunsWithSamples,
} from "./queries";

export {
  createProductionRunInTransaction,
  updateProductionRunInTransaction,
  deleteProductionRunInTransaction,
  createProductionRun,
  updateProductionRun,
  deleteProductionRun,
  ProductionRunDependencyError,
} from "./mutations";

export {
  assertProductionRunTimesNotFuture,
  type ProductionRunMutationOptions,
} from "./future-time";

export { ProductionRunOverlapError } from "./overlap";

export { productionRunDateExpr } from "./date-expr";

export { getProductionRunReadings } from "./readings";
