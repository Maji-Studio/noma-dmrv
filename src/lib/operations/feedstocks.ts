/**
 * Feedstock intake operations (data-entry API plan, Phase 0 pilot).
 *
 * `log_feedstock_delivery` is the compound, stock-moving create the plan
 * proves the runner on: feedstock rows, bin allocations, the derived
 * transport leg and the bin's first-use type lock, all in the runner's
 * transaction. The UI action still calls `createFeedstock`, which runs the
 * same body in a transaction of its own; Phase 1 moves the action onto this
 * operation.
 */

import {
  createFeedstockInTransaction,
  type CreateFeedstockResult,
} from "@/data-access/feedstocks";
import { resolveDistanceSource } from "@/schemas/distance-source";
import { createFeedstockSchema } from "@/schemas/feedstocks";
import type { Operation } from "./runner";

export const logFeedstockDelivery: Operation<
  typeof createFeedstockSchema,
  CreateFeedstockResult
> = {
  id: "log_feedstock_delivery",
  input: createFeedstockSchema,
  supportsDryRun: true,
  execute: ({ ctx, tx }, data) =>
    createFeedstockInTransaction(ctx, tx, {
      ...data,
      transportDistanceSource: resolveDistanceSource(
        data.transportDistanceKm,
        data.transportDistanceSource,
      ),
    }),
};
