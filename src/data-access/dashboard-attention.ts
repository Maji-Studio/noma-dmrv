/**
 * Shared attention predicates — the single source of truth for what "needs
 * operator follow-through" at each traceability station. Both dashboard
 * surfaces build their queries from these so they can never disagree:
 *
 *   - station badges (uncapped counts, `dashboard-stations.ts`)
 *   - the needs-attention list (capped sample rows, `dashboard-overview.ts`)
 *
 * Every predicate is facility- and org-scoped and skips archived rows. The
 * application evidence-gap check stays fail-closed (issue #461): an application
 * with unresolved evidence keeps surfacing until the gap is filled.
 */
import { and, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import {
  applications,
  biocharProducts,
  creditBatches,
  deliveries,
  feedstocks,
  productionRuns,
} from "@/db/schema";
import { applicationHasEvidenceGapSql } from "./application-evidence-sql";

/** Complete production runs missing either mass reading. */
export function runsMissingMassWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(productionRuns.organizationId, organizationId),
    eq(productionRuns.facilityId, facilityId),
    isNull(productionRuns.archivedAt),
    eq(productionRuns.status, "complete"),
    or(
      isNull(productionRuns.biocharDryMassKg),
      isNull(productionRuns.feedstockMassDryKg),
    ),
  );
}

/** Biochar products not yet linked back to the production run that made them. */
export function productsUnlinkedWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(biocharProducts.organizationId, organizationId),
    eq(biocharProducts.facilityId, facilityId),
    isNull(biocharProducts.archivedAt),
    isNull(biocharProducts.linkedProductionRunId),
  );
}

/** Feedstock records flagged as incomplete. */
export function feedstocksMissingDataWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(feedstocks.organizationId, organizationId),
    eq(feedstocks.facilityId, facilityId),
    isNull(feedstocks.archivedAt),
    eq(feedstocks.status, "missing_data"),
  );
}

/** Deliveries scheduled but not yet fulfilled. */
export function upcomingDeliveriesWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(deliveries.organizationId, organizationId),
    eq(deliveries.facilityId, facilityId),
    isNull(deliveries.archivedAt),
    eq(deliveries.status, "upcoming"),
  );
}

/** Pending credit batches whose measurement period has already closed. */
export function overdueBatchesWhere(
  organizationId: string,
  facilityId: string,
  todayStr: string,
): SQL | undefined {
  return and(
    eq(creditBatches.organizationId, organizationId),
    eq(creditBatches.facilityId, facilityId),
    isNull(creditBatches.archivedAt),
    eq(creditBatches.status, "pending"),
    lt(creditBatches.endDate, todayStr),
  );
}

/**
 * Applications with missing evidence. Scoped on the application's own org plus
 * the joined delivery's facility — the caller supplies the
 * `applications ⋈ deliveries` join. Fail-closed via
 * `applicationHasEvidenceGapSql` (issue #461).
 */
export function applicationEvidenceGapWhere(
  organizationId: string,
  facilityId: string,
): SQL | undefined {
  return and(
    eq(applications.organizationId, organizationId),
    eq(deliveries.facilityId, facilityId),
    isNull(deliveries.archivedAt),
    applicationHasEvidenceGapSql(),
  );
}
