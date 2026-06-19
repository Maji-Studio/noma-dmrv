/**
 * Production Processes Data Access Layer
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B (ADR 0016). It has no dedicated UI in Phase 1 — it is
 * auto-found-or-created when a credit batch is formed, defaulting to Method A.
 * The Method-B unlock + management surface ship with ADR 0017.
 */

import { and, desc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  productionProcesses,
  type ProductionProcess,
} from "@/db/schema";
import { requireAuth } from "./utils";

type Executor = DbTransaction | typeof db;

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
