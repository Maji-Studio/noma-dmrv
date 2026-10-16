import { activityFieldPolicies } from "@/lib/activity-changes";
import type { ActivityChanges } from "@/db/schema/activity";
import { facilities, suppliers, customers, customerLocations, vehicles, drivers, operators, feedstockTypes, storageLocations, reactors, formulations, productionProcesses, certificationSubmissions, biocharStorageInventory } from "@/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { applications, biocharProducts, binMovements, certifierGhgStatements, certifierRemovals, creditBatches, deliveries, documents, feedstocks, orders, productionRuns, samples, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { activityIds } from "./credit-batch-activity-members";
import { requireOrgScope } from "./utils";
import { documentOwnerActivityType, polymorphicOwnerActivityType, parseDocumentActivityReasonCode } from "@/lib/activity-entity-type";

const SHORT_RECORD_ID_LENGTH = 8;
/**
 * `facility` is where the record's side sheet lives today, which can differ
 * from the batch's facility (a detached run moved elsewhere). Null for records
 * without one; a document takes its owner's.
 */
type LabelSource = {
  table: PgTable; id: AnyPgColumn; organizationId: AnyPgColumn; label: AnyPgColumn | SQL<string | null>;
  facility: AnyPgColumn | SQL<string | null> | null;
};
const coded = <T extends PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn; code: AnyPgColumn; facilityId: AnyPgColumn }>(table: T): LabelSource =>
  ({ table, id: table.id, organizationId: table.organizationId, label: table.code, facility: table.facilityId });
const named = <T extends PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn; name: AnyPgColumn }>(table: T): LabelSource =>
  ({ table, id: table.id, organizationId: table.organizationId, label: table.name, facility: null });
const identified = <T extends PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn }>(table: T): LabelSource =>
  ({ table, id: table.id, organizationId: table.organizationId, label: sql<string | null>`null`, facility: null });
const sources: Record<string, LabelSource> = {
  facility: named(facilities), supplier: named(suppliers), customer: named(customers),
  customer_location: named(customerLocations), vehicle: named(vehicles), driver: named(drivers), operator: named(operators),
  feedstock_type: named(feedstockTypes), storage_location: named(storageLocations), formulation: named(formulations),
  reactor: coded(reactors), production_process: identified(productionProcesses), submission: identified(certificationSubmissions),
  storage_inventory: { ...identified(biocharStorageInventory), label: biocharStorageInventory.code },
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
export type ActivityRecordLabel = { label: string | null; deleted: boolean; facilityId: string | null; facilityTimezone: string | null };
type LoadedRecord = { label: string | null; facilityId: string | null };

/** Postgres accepts any 8-4-4-4-12 hex id; anything else would fail the `::uuid[]` cast. */
const uuidLike = z.guid();

/**
 * One org-scoped query per record type: each live record's label and current
 * facility. Ids that are not UUIDs (a malformed legacy reason code, say) are
 * dropped before the uuid cast and read as missing instead of failing the page.
 */
async function loadRecords(ctx: OrgContext, type: string, ids: readonly string[]): Promise<Map<string, LoadedRecord> | null> {
  requireOrgScope(ctx);
  const source = Object.hasOwn(sources, type) ? sources[type] : undefined;
  if (!source) return null;
  if (source.id.getSQLType() === "uuid") ids = ids.filter(id => uuidLike.safeParse(id).success);
  if (ids.length === 0) return new Map();
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
    label: row.label == null ? null : type === "bin_movement" ? outputStockEventLabel(String(row.label)) : String(row.label),
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
 * owner's facility, loaded in the same batched pass.
 */
export async function resolveActivityRecords(
  ctx: OrgContext,
  events: readonly { entityType: string; entityId: string; action: string; reasonCode?: string | null; changes?: ActivityChanges }[],
) {
  requireOrgScope(ctx);
  const result = new Map<string, ActivityRecordLabel>();
  const owners = events.flatMap(row => {
    if (row.entityType !== "document") return [];
    const reason = parseDocumentActivityReasonCode(row.reasonCode);
    const type = reason && documentOwnerActivityType(reason.ownerType);
    return reason && type ? [{ documentId: row.entityId, type, id: reason.ownerId }] : [];
  });
  const changeRefs = events.filter(row => row.action === "updated").flatMap(row => Object.entries(row.changes ?? {}).flatMap(([field, change]) =>
    (["from", "to"] as const).flatMap(side => {
      const type = changeLinkTarget(row.entityType, field, row.changes ?? {}, side, row.reasonCode);
      const id = change[side];
      return type && typeof id === "string" ? [{ type, id }] : [];
    })));
  await Promise.all([...groupIds([...events.map(row => ({ type: row.entityType, id: row.entityId })), ...changeRefs, ...owners])].map(async ([type, ids]) => {
    const loaded = await loadRecords(ctx, type, ids);
    for (const id of ids) {
      if (!loaded) {
        result.set(`${type}:${id}`, { label: `${type.replaceAll("_", " ")} ${id}`, deleted: false, facilityId: null, facilityTimezone: null });
        continue;
      }
      const record = loaded.get(id);
      result.set(`${type}:${id}`, { label: record?.label ?? null, deleted: !record, facilityId: record?.facilityId ?? null, facilityTimezone: null });
    }
  }));

  for (const owner of owners) {
    const document = result.get(`document:${owner.documentId}`)!;
    if (!document.deleted) result.set(`document:${owner.documentId}`, { ...document, facilityId: result.get(`${owner.type}:${owner.id}`)?.facilityId ?? null });
  }
  const facilityIds = [...new Set([...result.values()].flatMap(record => record.facilityId ? [record.facilityId] : []))];
  if (facilityIds.length > 0) {
    const zones = await db.select({ id: facilities.id, timezone: facilities.timezone }).from(facilities)
      .where(and(eq(facilities.organizationId, ctx.organizationId), activityIds(facilities.id, facilityIds)));
    const zonesById = new Map(zones.map(row => [row.id, row.timezone]));
    for (const record of result.values()) {
      record.facilityTimezone = record.facilityId ? zonesById.get(record.facilityId) ?? null : null;
    }
  }
  return result;
}

/** Resolve polymorphic owner IDs using their captured discriminator or document owner. */
function changeLinkTarget(entityType: string, field: string, changes: ActivityChanges, side: "from" | "to", reasonCode?: string | null): string | null {
  const policy = activityFieldPolicies[entityType]?.fields[field];
  if (typeof policy !== "object") return null;
  if (policy.link !== "$entityType") return policy.link;
  const owner = changes.entityType?.[side] ?? parseDocumentActivityReasonCode(reasonCode)?.ownerType;
  if (typeof owner !== "string") return null;
  return polymorphicOwnerActivityType(owner);
}

export type ActivityChangeLabel = { label: string | null; deleted: boolean; type: string | null };
export type ActivityChangeLabels = Record<string, { from: ActivityChangeLabel | null; to: ActivityChangeLabel | null }>;

/** Current labels and tombstones, separate from persisted IDs. */
export function activityChangeLabels(entityType: string, changes: ActivityChanges, records: Map<string, ActivityRecordLabel>, reasonCode?: string | null) {
  const result: ActivityChangeLabels = {};
  for (const [field, change] of Object.entries(changes)) {
    const policy = activityFieldPolicies[entityType]?.fields[field];
    if (typeof policy !== "object") continue;
    const label = (side: "from" | "to") => {
      const target = changeLinkTarget(entityType, field, changes, side, reasonCode);
      if (change[side] === null) return null;
      const record = target && Object.hasOwn(sources, target) && typeof change[side] === "string"
        ? records.get(`${target}:${change[side]}`) : undefined;
      return { label: record?.label ?? null, deleted: record?.deleted ?? false,
        type: target && Object.hasOwn(sources, target) ? target : null };
    };
    result[field] = { from: label("from"), to: label("to") };
  }
  return result;
}
