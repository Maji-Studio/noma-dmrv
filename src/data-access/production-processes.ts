/**
 * Production Processes Data Access Layer
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B (ADR 0016). It has no dedicated UI in Phase 1 — it is
 * auto-found-or-created when a credit batch is formed, defaulting to Method A.
 * The Method-B unlock + management surface ship with ADR 0017.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  productionProcesses,
  type ProductionProcess,
} from "@/db/schema";
import { requireAuth } from "./utils";

type Executor = DbTransaction | typeof db;
const PRODUCTION_PROCESS_CURRENT_LOCK_SCOPE = "production-process-current";

async function lockCurrentProductionProcess(
  executor: Executor,
  params: { facilityId: string; feedstockTypeId: string },
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${PRODUCTION_PROCESS_CURRENT_LOCK_SCOPE}:${params.facilityId}:${params.feedstockTypeId}`}, 0))`,
  );
}

/**
 * Find the CURRENT production process for a (facility, feedstock) pair, or
 * create one (Method A). "Current" = the most recently established — a new
 * process (feedstock/condition change, 3σ deviation) is opened by establishing
 * a later one, so the lookup is ordered by `establishedAt` desc. That re-keying
 * and the Method-B compute it feeds are deferred to ADR 0017; today every
 * process is Method A.
 *
 * Accepts an optional executor so it can participate in the credit-batch
 * creation transaction (find-or-create is read-then-write; running it inside the
 * caller's tx keeps it atomic with the batch insert).
 */
export async function findOrCreateProductionProcess(
  userId: string,
  params: { facilityId: string; feedstockTypeId: string },
  executor: Executor = db,
): Promise<ProductionProcess> {
  requireAuth(userId);

  if (executor === db) {
    return db.transaction((tx) =>
      findOrCreateProductionProcess(userId, params, tx),
    );
  }

  await lockCurrentProductionProcess(executor, params);

  const [existing] = await executor
    .select()
    .from(productionProcesses)
    .where(
      and(
        eq(productionProcesses.facilityId, params.facilityId),
        eq(productionProcesses.feedstockTypeId, params.feedstockTypeId),
      ),
    )
    .orderBy(desc(productionProcesses.establishedAt))
    .limit(1);

  if (existing) return existing;

  const [created] = await executor
    .insert(productionProcesses)
    .values({
      facilityId: params.facilityId,
      feedstockTypeId: params.feedstockTypeId,
    })
    .returning();

  return created;
}
