import { and, eq, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import { certifierRemovals, creditBatchApplications, deliveries, documents, samples, transportLegs, outputStockAllocations, outputStockRunAllocations, productionSamples, incidentReports, certifierGhgStatementReports } from "@/db/schema";
import { toActivityDocumentOwnerType } from "@/lib/activity-entity-type";
import type { OrgContext } from "@/lib/auth/server";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { requireOrgScope } from "./utils";

/** One bound array, including when a batch has thousands of members. */
export function activityIds(column: AnyColumn, ids: readonly string[]): SQL {
  const values = sql.param([...new Set(ids)]);
  return column.getSQLType() === "uuid"
    ? sql`${column} = any(${values}::uuid[])`
    : sql`${column} = any(${values}::text[])`;
}

export async function loadActivityMembers(ctx: OrgContext, batchId: string) {
  requireOrgScope(ctx);
  const rollup = (await loadCreditBatchRollups(ctx, [batchId], { includeRunForwards: true }))[batchId];
  if (!rollup) return null;
  const facts = rollup.lineageFacts;
  const forwards = Object.values(facts.runForwards ?? {}).flat();
  const ids: Record<string, string[]> = {
    production_run: facts.productionRunIds,
    feedstock: facts.runs.flatMap(run => run.feedstocks.map(row => row.id)),
    biochar_product: [...forwards.map(row => row.id), ...facts.applications.map(row => row.biocharProduct.id)],
    delivery: [...forwards.flatMap(row => row.deliveries.map(delivery => delivery.id)), ...facts.applications.map(row => row.delivery.id)],
    application: facts.applicationIds,
  };
  const [sampleRows, removalRows, deliveryRows] = await Promise.all([
    db.select({ id: samples.id }).from(samples).where(and(eq(samples.organizationId, ctx.organizationId), eq(samples.creditBatchId, batchId))),
    db.selectDistinct({ id: certifierRemovals.id, ghgStatementId: certifierRemovals.ghgStatementId }).from(creditBatchApplications)
      .innerJoin(certifierRemovals, and(eq(certifierRemovals.id, creditBatchApplications.removalId), eq(certifierRemovals.organizationId, ctx.organizationId)))
      .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, batchId))),
    db.select({ orderId: deliveries.orderId }).from(deliveries)
      .where(and(eq(deliveries.organizationId, ctx.organizationId), activityIds(deliveries.id, ids.delivery))),
  ]);
  ids.lab_sample = sampleRows.map(row => row.id);
  ids.order = deliveryRows.flatMap(row => row.orderId ? [row.orderId] : []);
  ids.removal = removalRows.map(row => row.id);
  ids.ghg_statement = removalRows.flatMap(row => row.ghgStatementId ? [row.ghgStatementId] : []);
  // Multi-run stock movements deliberately have no single production-run link.
  const movements = await db.selectDistinct({ id: outputStockAllocations.movementId }).from(outputStockAllocations)
    .leftJoin(outputStockRunAllocations, and(
      eq(outputStockRunAllocations.allocationId, outputStockAllocations.id),
      eq(outputStockRunAllocations.organizationId, ctx.organizationId),
    )).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), or(
      activityIds(outputStockAllocations.productionRunId, facts.productionRunIds),
      activityIds(outputStockRunAllocations.productionRunId, facts.productionRunIds),
    )));
  ids.bin_movement = movements.map(row => row.id);
  // These child records have document activity, but no entity activity of their own.
  const [measurements, incidents, reports] = await Promise.all([
    db.select({ id: productionSamples.id }).from(productionSamples).where(and(
      eq(productionSamples.organizationId, ctx.organizationId), activityIds(productionSamples.productionRunId, facts.productionRunIds))),
    db.select({ id: incidentReports.id }).from(incidentReports).where(and(
      eq(incidentReports.organizationId, ctx.organizationId), activityIds(incidentReports.productionRunId, facts.productionRunIds))),
    db.select({ id: certifierGhgStatementReports.id }).from(certifierGhgStatementReports).where(and(
      eq(certifierGhgStatementReports.organizationId, ctx.organizationId), activityIds(certifierGhgStatementReports.ghgStatementId, ids.ghg_statement))),
  ]);
  const reportIds = reports.map(row => row.id);
  const owners = { ...ids, credit_batch: [batchId], sample: ids.lab_sample, biochar: ids.biochar_product,
    production_sample: measurements.map(row => row.id), production_incident: incidents.map(row => row.id),
    ghgStatement: ids.ghg_statement, ghg_statement_report: reportIds, ghgStatementReport: reportIds,
  };
  const ownerMatch = (type: AnyColumn, id: AnyColumn) => or(...Object.entries(owners)
    .map(([key, values]) => and(sql`${type}::text = ${key}`, activityIds(id, values))));
  const legs = await db.select({ id: transportLegs.id }).from(transportLegs)
    .where(and(eq(transportLegs.organizationId, ctx.organizationId), ownerMatch(transportLegs.entityType, transportLegs.entityId)));
  ids.transport_leg = legs.map(row => row.id);
  const docs = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.organizationId, ctx.organizationId), or(
      ownerMatch(documents.entityType, documents.entityId),
      and(eq(documents.entityType, "transport_leg"), activityIds(documents.entityId, ids.transport_leg)),
    )));
  ids.document = docs.map(row => row.id);
  const documentOwners: Record<string, string[]> = {};
  for (const [type, values] of Object.entries({ ...owners, transport_leg: ids.transport_leg })) {
    const ownerType = toActivityDocumentOwnerType(type === "biochar" ? "biochar_product" : type);
    documentOwners[ownerType] = [...new Set([...(documentOwners[ownerType] ?? []), ...values])];
  }
  return { ids, documentOwners };
}
