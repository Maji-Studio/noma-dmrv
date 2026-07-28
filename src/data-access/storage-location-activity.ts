/**
 * Storage-bin activity timestamp.
 *
 * "Last activity" on a bin is not a column: it is the most recent of the
 * inventory events that touched the bin — feedstock arriving, a production run
 * drawing from or filling it, and biochar products allocated out of or stored
 * in it. `storage-location-enrichment.ts` reads the full event (direction,
 * mass, label) for the current page; this module answers the narrower question
 * "when did anything last happen here?" for a single bin, correlated to the
 * outer row, so the list can ORDER BY it before paginating.
 *
 * Both live off the same five sources on purpose. If they diverged, the board
 * would sort by one timestamp and print another.
 */

import { sql, type SQL } from "drizzle-orm";
import {
  biocharProducts,
  binMovements,
  feedstocks,
  productionRuns,
  storageLocations,
} from "@/db/schema";

/**
 * Correlated scalar subquery yielding the bin's most recent activity timestamp,
 * or NULL when nothing has ever touched it.
 *
 * Every column is written through its Drizzle reference so it renders fully
 * qualified — an unqualified name inside this many UNION branches resolves
 * against the wrong table without erroring.
 */
export function storageLocationLastActivityAt(organizationId: string): SQL<Date | null> {
  return sql<Date | null>`(
    SELECT MAX(activity.occurred_at)
    FROM (
      SELECT ${feedstocks.createdAt} AS occurred_at
      FROM ${feedstocks}
      WHERE ${feedstocks.organizationId} = ${organizationId}
        AND ${feedstocks.storageLocationId} = ${storageLocations.id}

      UNION ALL

      SELECT ${productionRuns.createdAt}
      FROM ${productionRuns}
      WHERE ${productionRuns.organizationId} = ${organizationId}
        AND ${productionRuns.feedstockStorageLocationId} = ${storageLocations.id}

      UNION ALL

      SELECT ${productionRuns.createdAt}
      FROM ${productionRuns}
      WHERE ${productionRuns.organizationId} = ${organizationId}
        AND ${productionRuns.biocharStorageLocationId} = ${storageLocations.id}

      UNION ALL

      SELECT ${biocharProducts.createdAt}
      FROM ${biocharProducts}
      JOIN ${productionRuns}
        ON ${biocharProducts.linkedProductionRunId} = ${productionRuns.id}
        AND ${productionRuns.organizationId} = ${organizationId}
      WHERE ${biocharProducts.organizationId} = ${organizationId}
        AND ${productionRuns.biocharStorageLocationId} = ${storageLocations.id}

      UNION ALL

      SELECT ${biocharProducts.createdAt}
      FROM ${biocharProducts}
      WHERE ${biocharProducts.organizationId} = ${organizationId}
        AND ${biocharProducts.storageLocationId} = ${storageLocations.id}

      UNION ALL

      SELECT ${binMovements.createdAt}
      FROM ${binMovements}
      WHERE ${binMovements.organizationId} = ${organizationId}
        AND ${binMovements.storageLocationId} = ${storageLocations.id}
    ) AS activity
  )`;
}
