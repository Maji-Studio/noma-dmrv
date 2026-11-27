import { and, eq, or } from "drizzle-orm";
import { productionRuns, storageLocations } from "@/db/schema";
import { PRODUCTION_RUN_STOCK_PAIRS } from "@/lib/storage-location-material";

/** Requires a scoped join to storageLocations on the run's output bin. */
export function productionRunAddsStockSql() {
  return or(...PRODUCTION_RUN_STOCK_PAIRS.map(pair => and(
    eq(productionRuns.status, pair.status), eq(storageLocations.uncarbonized, pair.uncarbonized),
  )));
}
