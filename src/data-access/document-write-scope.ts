import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import type { DbTransaction } from "@/db";
import { applications, biocharProducts, creditBatches, deliveries, documents, facilities, feedstockDeliveries, feedstocks, incidentReports, orders, productionRuns, productionSamples, reactors, samples, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { DOCUMENT_ENTITY_TYPES, type DocumentEntityType } from "@/schemas/documents";
import { assertLockedLineagesAllowMutation, CertificationLineageChangedError, getCertifiedLineage, isSubmittedLineageRow, lockCertifiedLineageArtifacts, type CertifiedLineageTarget } from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

type OwnerTable = AnyPgTable & { id: AnyPgColumn; organizationId: AnyPgColumn; archivedAt?: AnyPgColumn };
interface OwnerSpec { table: OwnerTable; target?: CertifiedLineageTarget["entityType"]; parent?: { type: DocumentEntityType; column: AnyPgColumn } }
const OWNERS: Record<DocumentEntityType, OwnerSpec> = {
  sample: { table: samples, target: "sample", parent: { type: "credit_batch", column: samples.creditBatchId } },
  application: { table: applications, target: "application", parent: { type: "delivery", column: applications.deliveryId } },
  production_incident: { table: incidentReports, parent: { type: "production_run", column: incidentReports.productionRunId } },
  production_sample: { table: productionSamples, parent: { type: "production_run", column: productionSamples.productionRunId } },
  delivery: { table: deliveries, target: "delivery" },
  feedstock: { table: feedstocks, target: "feedstock" },
  production_run: { table: productionRuns, target: "productionRun" },
  biochar_product: { table: biocharProducts, target: "biocharProduct" },
  credit_batch: { table: creditBatches, target: "creditBatch" },
  order: { table: orders, target: "order" },
  facility: { table: facilities }, reactor: { table: reactors },
  feedstock_delivery: { table: feedstockDeliveries }, transport_leg: { table: transportLegs },
};
const OWNER_FIELDS: Record<DocumentEntityType, string> = {
  sample: "labSampleId", delivery: "deliveryId", feedstock: "feedstockId", application: "applicationId",
  production_run: "productionRunId", production_incident: "productionIncidentId", production_sample: "productionSampleId",
  biochar_product: "biocharProductId", credit_batch: "creditBatchId", order: "orderId", facility: "facilityId",
  reactor: "reactorId", feedstock_delivery: "feedstockDeliveryId", transport_leg: "transportLegId",
};
export function documentOwnerField(type: DocumentEntityType): string { return OWNER_FIELDS[type]; }
export function documentNotFound(field = "documentId"): DomainError {
  return new DomainError("not_found", "Document not found", { issues: [{ path: [field], code: "not_found", message: "Document not found" }] });
}
export function changedOwner(): DomainError { return new DomainError("conflict", "Certification lineage changed while it was being locked. Refresh and retry.", { retryable: true }); }
interface OwnerLink { type: DocumentEntityType; id: string; archived: boolean; parentId: string | null; legacyId: string | null; parentType: string | null }
async function readOwner(ctx: OrgContext, tx: DbTransaction, type: DocumentEntityType, id: string, lock = false): Promise<OwnerLink | undefined> {
  const spec = OWNERS[type]; const table = spec.table;
  const query = tx.select({
    id: sql<string>`${table.id}`, archived: table.archivedAt ? sql<boolean>`${table.archivedAt} is not null` : sql<boolean>`false`,
    parentId: spec.parent ? sql<string | null>`${spec.parent.column}` : type === "transport_leg" ? sql<string>`${transportLegs.entityId}` : sql<null>`null`,
    legacyId: type === "sample" ? sql<string | null>`${samples.productionRunId}` : sql<null>`null`,
    parentType: type === "transport_leg" ? sql<string>`${transportLegs.entityType}` : sql<null>`null`,
  }).from(table).where(and(eq(table.id, id), eq(table.organizationId, ctx.organizationId)));
  const [row] = lock ? await query.for("share") : await query;
  return row && { type, ...row };
}
async function discover(ctx: OrgContext, tx: DbTransaction, type: DocumentEntityType, id: string): Promise<OwnerLink[]> {
  const row = await readOwner(ctx, tx, type, id);
  if (!row) throw documentNotFound(OWNER_FIELDS[type]);
  let parentType = OWNERS[type].parent?.type;
  let parentId = row.parentId;
  if (type === "sample" && !parentId) { parentType = "production_run"; parentId = row.legacyId; }
  if (type === "transport_leg") {
    const transportParents: Record<string, DocumentEntityType> = { feedstock: "feedstock", biochar: "biochar_product", sample: "sample" };
    parentType = transportParents[row.parentType ?? ""];
    if (!parentType) throw documentNotFound(OWNER_FIELDS[type]);
  }
  return parentType && parentId ? [...await discover(ctx, tx, parentType, parentId), row] : [row];
}
export interface DocumentWriteScope { links: OwnerLink[]; targets: CertifiedLineageTarget[]; keys: ReadonlySet<string>; field: string }
async function targetsFor(ctx: OrgContext, tx: DbTransaction, links: OwnerLink[]): Promise<CertifiedLineageTarget[]> {
  const owner = links[links.length - 1];
  // The legacy intake grouping has no direct CertifiedLineageTarget. Its
  // retained evidence covers each intake belonging to that grouping.
  if (owner.type === "feedstock_delivery") {
    const rows = await tx.select({ id: feedstocks.id }).from(feedstocks)
      .where(and(eq(feedstocks.feedstockDeliveryId, owner.id), eq(feedstocks.organizationId, ctx.organizationId)))
      .orderBy(feedstocks.id);
    return rows.map((row) => ({ entityType: "feedstock", entityId: row.id }));
  }
  // The owner's own target includes its ancestors. Internal children inherit theirs.
  const link = [...links].reverse().find((entry) => OWNERS[entry.type].target);
  return link ? [{ entityType: OWNERS[link.type].target!, entityId: link.id }] : [];
}
export async function lockDocumentOwner(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string): Promise<DocumentWriteScope> {
  requireOrgScope(ctx);
  if (!DOCUMENT_ENTITY_TYPES.includes(entityType as DocumentEntityType)) throw documentNotFound("entityId");
  const type = entityType as DocumentEntityType;
  const links = await discover(ctx, tx, type, entityId);
  const targets = await targetsFor(ctx, tx, links);
  const keys = await lockCertifiedLineageArtifacts(ctx, tx, targets);
  const locked: OwnerLink[] = [];
  for (const link of links) {
    const row = await readOwner(ctx, tx, link.type, link.id, true);
    if (!row) throw documentNotFound(OWNER_FIELDS[type]);
    if (row.parentId !== link.parentId || row.parentType !== link.parentType || row.legacyId !== link.legacyId) throw changedOwner();
    locked.push(row);
  }
  return { links: locked, targets, keys, field: OWNER_FIELDS[type] };
}
export async function assertDocumentOwnerWritable(ctx: OrgContext, tx: DbTransaction, scope: DocumentWriteScope, allowArchived = false): Promise<void> {
  requireOrgScope(ctx);
  if (!allowArchived && scope.links.some((row) => row.archived)) throw documentNotFound(scope.field);
  const currentTargets = await targetsFor(ctx, tx, scope.links);
  if (JSON.stringify(currentTargets) !== JSON.stringify(scope.targets)) throw changedOwner();
  try {
    await assertLockedLineagesAllowMutation(ctx, tx, scope.keys, scope.targets.map((target) => ({ target, mutation: "update" })));
  } catch (error) {
    if (error instanceof CertificationLineageChangedError) throw changedOwner();
    if (error instanceof SafeError) throw new DomainError("certification_locked", error.message, { issues: [{ path: [scope.field], code: "certification_locked", message: error.message }] });
    throw error;
  }
}
async function discoverOwner(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string): Promise<OwnerLink[]> {
  if (!DOCUMENT_ENTITY_TYPES.includes(entityType as DocumentEntityType)) throw documentNotFound("entityId");
  return discover(ctx, tx, entityType as DocumentEntityType, entityId);
}
/**
 * The lineage targets the document writers lock for this owner, unlocked and
 * archive-blind, for advisory reads. Owners without lineage return none.
 */
export async function documentOwnerLineageTargets(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string): Promise<CertifiedLineageTarget[]> {
  requireOrgScope(ctx);
  return targetsFor(ctx, tx, await discoverOwner(ctx, tx, entityType, entityId));
}
/** Preparation only. The locked writer repeats this decision after storage inspection. */
export async function inspectDocumentOwner(ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string): Promise<boolean> {
  requireOrgScope(ctx);
  const links = await discoverOwner(ctx, tx, entityType, entityId);
  if (links.some((link) => link.archived)) throw documentNotFound(OWNER_FIELDS[entityType as DocumentEntityType]);
  return ownerHasSubmittedLineage(ctx, tx, await targetsFor(ctx, tx, links));
}
export async function ownerHasSubmittedLineage(ctx: OrgContext, tx: DbTransaction, targets: CertifiedLineageTarget[]): Promise<boolean> {
  requireOrgScope(ctx);
  for (const target of targets) if ((await getCertifiedLineage(ctx, tx, target)).some(isSubmittedLineageRow)) return true;
  return false;
}
export async function readDocumentForWrite(ctx: OrgContext, tx: DbTransaction, id: string, lock = false) {
  requireOrgScope(ctx);
  const query = tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId)));
  const [row] = lock ? await query.for("update") : await query;
  return row;
}
