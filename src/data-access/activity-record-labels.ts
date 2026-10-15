import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { applications, biocharProducts, binMovements, certifierGhgStatements, certifierRemovals, creditBatches, deliveries, documents, feedstocks, orders, productionRuns, samples, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { activityIds } from "./credit-batch-activity-members";
import { requireOrgScope } from "./utils";

const SHORT_RECORD_ID_LENGTH = 8;
type LabelSource = { table: PgTable; id: AnyPgColumn; organizationId: AnyPgColumn; label: AnyPgColumn | SQL<string> };
const coded = <T extends PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn; code: AnyPgColumn }>(table: T): LabelSource =>
  ({ table, id: table.id, organizationId: table.organizationId, label: table.code });
const sources: Record<string, LabelSource> = {
  credit_batch: coded(creditBatches), production_run: coded(productionRuns), feedstock: coded(feedstocks),
  biochar_product: coded(biocharProducts), lab_sample: { table: samples, id: samples.id, organizationId: samples.organizationId, label: samples.sampleCode }, order: coded(orders),
  delivery: coded(deliveries), application: coded(applications),
  document: { table: documents, id: documents.id, organizationId: documents.organizationId, label: sql<string>`'Document'` },
  removal: { table: certifierRemovals, id: certifierRemovals.id, organizationId: certifierRemovals.organizationId,
    label: sql<string>`left(${certifierRemovals.id}::text, ${SHORT_RECORD_ID_LENGTH})` },
  ghg_statement: { table: certifierGhgStatements, id: certifierGhgStatements.id, organizationId: certifierGhgStatements.organizationId,
    label: certifierGhgStatements.reportingPeriodEndOn },
  transport_leg: { table: transportLegs, id: transportLegs.id, organizationId: transportLegs.organizationId,
    label: sql<string>`concat(coalesce(${transportLegs.originName}, 'Origin'), ' to ', coalesce(${transportLegs.destinationName}, 'Destination'))` },
  bin_movement: { table: binMovements, id: binMovements.id, organizationId: binMovements.organizationId,
    label: sql<string>`coalesce(${binMovements.outputKind}, ${binMovements.movementType}::text)` },
};
export type ActivityRecordLabel = { label: string | null; deleted: boolean };

/** Unknown types remain readable when a writer is deployed before its label resolver. */
export async function resolveActivityRecords(ctx: OrgContext, events: readonly { entityType: string; entityId: string }[]) {
  requireOrgScope(ctx);
  const groups = new Map<string, string[]>();
  for (const row of events) groups.set(row.entityType, [...(groups.get(row.entityType) ?? []), row.entityId]);
  const result = new Map<string, ActivityRecordLabel>();
  await Promise.all([...groups].map(async ([type, ids]) => {
    const source = Object.hasOwn(sources, type) ? sources[type] : undefined;
    if (!source) {
      for (const id of ids) result.set(`${type}:${id}`, { label: `${type.replaceAll("_", " ")} ${id}`, deleted: false });
      return;
    }
    if (type === "ghg_statement") {
      const statements = await db.select({ id: certifierGhgStatements.id,
        start: certifierGhgStatements.reportingPeriodStartOn, end: certifierGhgStatements.reportingPeriodEndOn,
      }).from(certifierGhgStatements).where(and(eq(certifierGhgStatements.organizationId, ctx.organizationId), activityIds(certifierGhgStatements.id, ids)));
      const byId = new Map(statements.map(row => [row.id, row.start ? formatDateRange(row.start, row.end) : `Ends ${formatDate(row.end)}`]));
      for (const id of ids) result.set(`${type}:${id}`, { label: byId.get(id) ?? null, deleted: !byId.has(id) });
      return;
    }
    const rows = await db.select({ id: source.id, label: source.label }).from(source.table)
      .where(and(eq(source.organizationId, ctx.organizationId), activityIds(source.id, ids)));
    const byId = new Map(rows.map(row => [String(row.id), String(row.label)]));
    for (const id of ids) {
      const label = byId.get(id);
      result.set(`${type}:${id}`, { label: label === undefined ? null : type === "bin_movement" ? outputStockEventLabel(label) : label, deleted: label === undefined });
    }
  }));
  return result;
}
