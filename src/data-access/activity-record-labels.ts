import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { applications, biocharProducts, binMovements, certifierGhgStatements, certifierRemovals, creditBatches, deliveries, documents, feedstocks, orders, productionRuns, samples, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { activityIds } from "./credit-batch-activity-members";
import { requireOrgScope } from "./utils";
import { documentOwnerActivityType, parseDocumentActivityReasonCode } from "@/lib/activity-entity-type";

const SHORT_RECORD_ID_LENGTH = 8;
/**
 * `facility` is where the record's side sheet lives today, which can differ
 * from the batch's facility (a detached run moved elsewhere). Null for records
 * without one; a document takes its owner's.
 */
type LabelSource = {
  table: PgTable; id: AnyPgColumn; organizationId: AnyPgColumn; label: AnyPgColumn | SQL<string>;
  facility: AnyPgColumn | SQL<string | null> | null;
};
const coded = <T extends PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn; code: AnyPgColumn; facilityId: AnyPgColumn }>(table: T): LabelSource =>
  ({ table, id: table.id, organizationId: table.organizationId, label: table.code, facility: table.facilityId });
const sources: Record<string, LabelSource> = {
  credit_batch: coded(creditBatches), production_run: coded(productionRuns), feedstock: coded(feedstocks),
  biochar_product: coded(biocharProducts), order: coded(orders), delivery: coded(deliveries),
  // A sample belongs to its credit batch's facility.
  lab_sample: { table: samples, id: samples.id, organizationId: samples.organizationId, label: samples.sampleCode,
    facility: sql<string | null>`(select ${creditBatches.facilityId} from ${creditBatches} where ${creditBatches.id} = ${samples.creditBatchId} and ${creditBatches.organizationId} = ${samples.organizationId})` },
  // An application's facility is its delivery's.
  application: { table: applications, id: applications.id, organizationId: applications.organizationId, label: applications.code,
    facility: sql<string | null>`(select ${deliveries.facilityId} from ${deliveries} where ${deliveries.id} = ${applications.deliveryId} and ${deliveries.organizationId} = ${applications.organizationId})` },
  document: { table: documents, id: documents.id, organizationId: documents.organizationId, label: sql<string>`'Document'`, facility: null },
  removal: { table: certifierRemovals, id: certifierRemovals.id, organizationId: certifierRemovals.organizationId,
    label: sql<string>`left(${certifierRemovals.id}::text, ${SHORT_RECORD_ID_LENGTH})`, facility: certifierRemovals.facilityId },
  ghg_statement: { table: certifierGhgStatements, id: certifierGhgStatements.id, organizationId: certifierGhgStatements.organizationId,
    label: certifierGhgStatements.reportingPeriodEndOn, facility: certifierGhgStatements.facilityId },
  transport_leg: { table: transportLegs, id: transportLegs.id, organizationId: transportLegs.organizationId,
    label: sql<string>`concat(coalesce(${transportLegs.originName}, 'Origin'), ' to ', coalesce(${transportLegs.destinationName}, 'Destination'))`, facility: null },
  bin_movement: { table: binMovements, id: binMovements.id, organizationId: binMovements.organizationId,
    label: sql<string>`coalesce(${binMovements.outputKind}, ${binMovements.movementType}::text)`, facility: null },
};
export type ActivityRecordLabel = { label: string | null; deleted: boolean; facilityId: string | null };
type LoadedRecord = { label: string; facilityId: string | null };

/** One org-scoped query per record type: each live record's label and current facility. */
async function loadRecords(ctx: OrgContext, type: string, ids: readonly string[]): Promise<Map<string, LoadedRecord> | null> {
  requireOrgScope(ctx);
  const source = Object.hasOwn(sources, type) ? sources[type] : undefined;
  if (!source) return null;
  const facility = source.facility ?? sql<string | null>`null`;
  if (type === "ghg_statement") {
    const statements = await db.select({ id: certifierGhgStatements.id, facilityId: certifierGhgStatements.facilityId,
      start: certifierGhgStatements.reportingPeriodStartOn, end: certifierGhgStatements.reportingPeriodEndOn,
    }).from(certifierGhgStatements).where(and(eq(certifierGhgStatements.organizationId, ctx.organizationId), activityIds(certifierGhgStatements.id, ids)));
    return new Map(statements.map(row => [row.id, {
      label: row.start ? formatDateRange(row.start, row.end) : `Ends ${formatDate(row.end)}`, facilityId: row.facilityId,
    }]));
  }
  const rows = await db.select({ id: source.id, label: source.label, facilityId: facility }).from(source.table)
    .where(and(eq(source.organizationId, ctx.organizationId), activityIds(source.id, ids)));
  return new Map(rows.map(row => [String(row.id), {
    label: type === "bin_movement" ? outputStockEventLabel(String(row.label)) : String(row.label),
    facilityId: row.facilityId == null ? null : String(row.facilityId),
  }]));
}

function groupIds(refs: Iterable<{ type: string; id: string }>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const ref of refs) groups.set(ref.type, [...(groups.get(ref.type) ?? []), ref.id]);
  return groups;
}

/**
 * Labels, tombstones and link facilities for a page of events, batched per
 * record type. Unknown types remain readable when a writer is deployed before
 * its label resolver. A document links to its owner, so it carries the
 * owner's facility (a second batched pass over the owners).
 */
export async function resolveActivityRecords(
  ctx: OrgContext,
  events: readonly { entityType: string; entityId: string; reasonCode?: string | null }[],
) {
  requireOrgScope(ctx);
  const result = new Map<string, ActivityRecordLabel>();
  await Promise.all([...groupIds(events.map(row => ({ type: row.entityType, id: row.entityId })))].map(async ([type, ids]) => {
    const loaded = await loadRecords(ctx, type, ids);
    for (const id of ids) {
      if (!loaded) {
        result.set(`${type}:${id}`, { label: `${type.replaceAll("_", " ")} ${id}`, deleted: false, facilityId: null });
        continue;
      }
      const record = loaded.get(id);
      result.set(`${type}:${id}`, { label: record?.label ?? null, deleted: !record, facilityId: record?.facilityId ?? null });
    }
  }));

  const owners = events.flatMap(row => {
    if (row.entityType !== "document" || result.get(`document:${row.entityId}`)?.deleted) return [];
    const reason = parseDocumentActivityReasonCode(row.reasonCode);
    const type = reason && documentOwnerActivityType(reason.ownerType);
    return reason && type ? [{ documentId: row.entityId, type, id: reason.ownerId }] : [];
  });
  const ownerRecords = new Map<string, LoadedRecord>();
  await Promise.all([...groupIds(owners)].map(async ([type, ids]) => {
    for (const [id, record] of (await loadRecords(ctx, type, ids)) ?? []) ownerRecords.set(`${type}:${id}`, record);
  }));
  for (const owner of owners) {
    const document = result.get(`document:${owner.documentId}`)!;
    result.set(`document:${owner.documentId}`, { ...document, facilityId: ownerRecords.get(`${owner.type}:${owner.id}`)?.facilityId ?? null });
  }
  return result;
}
