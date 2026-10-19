/**
 * Advisory lock reads for screens (#1119): one batched call per list or sheet.
 *
 * The level comes from the shared predicate (`recordLocks`, ADR 0035); this
 * file only resolves the holders into links a screen can show. Writers never
 * read it: they re-check under their own locks.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, biocharProducts, binMovements, certifierGhgStatements, certifierRemovals, creditBatches, deliveries, feedstocks, orders,
  outputStockAllocations, productionRuns, samples, storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { recordLocks, type RecordLock, type RecordLockHolder } from "@/lib/record-lock";
import type { RecordLockLink, RecordLockView, RecordLockViews } from "@/lib/record-lock-view";
import { getRecordLocks, type CertifiedLineageEntityType, type CertifiedLineageTarget } from "./certification-lineage-guards";
import { readRecordDependentsBatch } from "./record-lock-dependents";
import { readRecordLockLineage } from "./record-lock-lineage";
import { countStorageLocationReferencesForBins } from "./storage-location-references";
import { requireOrgScope } from "./utils";

const TARGET_TABLES = {
  feedstock: feedstocks, productionRun: productionRuns, sample: samples, biocharProduct: biocharProducts,
  order: orders, delivery: deliveries, application: applications, creditBatch: creditBatches,
} as const;

/** Ids of `entityType` that exist in this organization; foreign ids drop out silently. */
async function ownedIds(ctx: OrgContext, entityType: CertifiedLineageEntityType, ids: readonly string[]): Promise<string[]> {
  requireOrgScope(ctx);
  const table = TARGET_TABLES[entityType];
  const rows = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.organizationId, ctx.organizationId), inArray(table.id, [...ids])));
  const found = new Set(rows.map(row => row.id));
  return ids.filter(id => found.has(id));
}

/** Lock views for one record kind, keyed by id. Unknown or foreign ids are absent. */
export async function getRecordLockViews(ctx: OrgContext, entityType: CertifiedLineageEntityType, ids: readonly string[]): Promise<RecordLockViews> {
  requireOrgScope(ctx);
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const owned = await ownedIds(ctx, entityType, unique);
  if (!owned.length) return {};
  const targets: CertifiedLineageTarget[] = owned.map(entityId => ({ entityType, entityId }));
  // Sent first, from every ledger row of the lineage; dependents separately so
  // "Used by" stays complete even when a Removal holds the record.
  const sent = await getRecordLocks(ctx, db, targets, { sentOnly: true });
  const dependentsById = await readRecordDependentsBatch(ctx, db, entityType, owned);
  const dependents = owned.map(id => dependentsById.get(id) ?? []);
  // The Sent pass also names any returned Removal; keep it on the dependency lock.
  const locks: RecordLock[] = targets.map((target, index) => sent[index].level === "sent"
    ? sent[index]
    : { ...recordLocks[target.entityType]({ dependents: dependents[index], removals: [] }), returnedBy: sent[index].returnedBy });
  const links = await resolveRecordLockLinks(ctx, [...locks.flatMap(lock => [...lock.heldBy, ...returnHolders(lock)]), ...dependents.flat()]);
  return Object.fromEntries(owned.map((id, index) => [id, toView(locks[index], dependents[index], links)]));
}

/**
 * A Removal's own lock, for the Removals list and sheet: Sent, or returned by
 * Isometric with the statement that came back ("Correction needed").
 */
export async function getRemovalLockViews(ctx: OrgContext, ids: readonly string[]): Promise<RecordLockViews> {
  requireOrgScope(ctx);
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const rows = await db.select({ removalId: certifierRemovals.id, ghgStatementId: certifierRemovals.ghgStatementId }).from(certifierRemovals)
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, unique)));
  const facts = await readRecordLockLineage(ctx, db, rows, true);
  const locks = facts.map(fact => [fact.id, recordLocks.removal({ dependents: [], removals: [fact] })] as const);
  const links = await resolveRecordLockLinks(ctx, locks.flatMap(([id, lock]) => [...lock.heldBy, ...returnHolders(lock), { kind: "removal", id }]));
  return Object.fromEntries(locks.map(([id, lock]) => [id, toView(lock, [], links)]));
}

function returnHolders(lock: RecordLock): RecordLockHolder[] {
  return (lock.returnedBy ?? []).flatMap(returned => [
    { kind: "removal", id: returned.removalId },
    ...returned.statements.map(statement => ({ kind: "ghgStatement", id: statement.id })),
  ]);
}

/**
 * Storage bins have no registry lineage. A bin is In use once any stock row
 * points at it, which is exactly when the identity guard refuses a storage
 * type or feedstock type change (#767).
 */
export async function getStorageBinLockViews(ctx: OrgContext, ids: readonly string[]): Promise<RecordLockViews> {
  requireOrgScope(ctx);
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const rows = await db.select({ id: storageLocations.id, facilityId: storageLocations.facilityId }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, unique)));
  const binIds = rows.map(bin => bin.id);
  if (!binIds.length) return {};
  const [referencesByBin, storedFormulations, latestByBin] = await Promise.all([
    countStorageLocationReferencesForBins(ctx, db, binIds),
    // The formulation guard compares every product stored in the bin.
    db.selectDistinct({ binId: biocharProducts.storageLocationId, formulationId: biocharProducts.formulationId }).from(biocharProducts)
      .where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.storageLocationId, binIds))),
    latestBinRecords(ctx, binIds),
  ]);
  const views = rows.map((bin) => {
    const references = (referencesByBin.get(bin.id) ?? []).filter(reference => reference.count > 0);
    const dependents: RecordLockHolder[] = references.map(reference => ({ kind: "binReference", id: reference.blocker, label: reference.blocker }));
    const lock = recordLocks.storageLocation({ dependents, removals: [] });
    const usedBy: RecordLockLink[] = references.map(reference => ({
      kind: "binReference", id: reference.blocker, label: reference.blocker, facilityId: bin.facilityId, count: reference.count,
    }));
    const latest = latestByBin.get(bin.id);
    // The lock line names the most recent record of its stock history, as a link.
    const heldBy: RecordLockLink[] = latest && lock.level !== "open"
      ? [{ kind: latest.kind, id: latest.id, label: latest.label, facilityId: latest.facilityId }] : [];
    const view: RecordLockView = { level: lock.level, heldBy, usedBy, freeFields: [...lock.freeFields], howToFree: lock.howToFree, returnedBy: [],
      productFormulationIds: storedFormulations.filter(row => row.binId === bin.id).map(row => row.formulationId) };
    return [bin.id, view] as const;
  });
  return Object.fromEntries(views);
}

/**
 * The most recent record that put stock in or took it out of each bin, one
 * query per source table: intake, production output, product placement and
 * delivery. Losses and counts have no record to link and are not named.
 */
async function latestBinRecords(ctx: OrgContext, binIds: readonly string[]): Promise<Map<string, RecordLockLink & { at: Date }>> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const ids = [...binIds];
  const [intakes, runs, products, deliveryRows] = await Promise.all([
    db.selectDistinctOn([feedstocks.storageLocationId], { binId: feedstocks.storageLocationId, id: feedstocks.id, code: feedstocks.code, facilityId: feedstocks.facilityId, at: feedstocks.createdAt })
      .from(feedstocks).where(and(eq(feedstocks.organizationId, org), inArray(feedstocks.storageLocationId, ids)))
      .orderBy(feedstocks.storageLocationId, desc(feedstocks.createdAt)),
    db.selectDistinctOn([productionRuns.biocharStorageLocationId], { binId: productionRuns.biocharStorageLocationId, id: productionRuns.id, code: productionRuns.code, facilityId: productionRuns.facilityId, at: productionRuns.createdAt })
      .from(productionRuns).where(and(eq(productionRuns.organizationId, org), inArray(productionRuns.biocharStorageLocationId, ids)))
      .orderBy(productionRuns.biocharStorageLocationId, desc(productionRuns.createdAt)),
    db.selectDistinctOn([biocharProducts.storageLocationId], { binId: biocharProducts.storageLocationId, id: biocharProducts.id, code: biocharProducts.code, facilityId: biocharProducts.facilityId, at: biocharProducts.createdAt })
      .from(biocharProducts).where(and(eq(biocharProducts.organizationId, org), inArray(biocharProducts.storageLocationId, ids)))
      .orderBy(biocharProducts.storageLocationId, desc(biocharProducts.createdAt)),
    db.selectDistinctOn([deliveries.storageLocationId], { binId: deliveries.storageLocationId, id: deliveries.id, code: deliveries.code, facilityId: deliveries.facilityId, at: deliveries.createdAt })
      .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.storageLocationId, ids)))
      .orderBy(deliveries.storageLocationId, desc(deliveries.createdAt)),
  ]);
  const latest = new Map<string, RecordLockLink & { at: Date }>();
  for (const [kind, rows] of [["feedstock", intakes], ["productionRun", runs], ["biocharProduct", products], ["delivery", deliveryRows]] as const) {
    for (const row of rows) {
      if (!row.binId) continue;
      const current = latest.get(row.binId);
      if (!current || row.at > current.at) latest.set(row.binId, { kind, id: row.id, label: row.code, facilityId: row.facilityId, at: row.at });
    }
  }
  return latest;
}

const linkKey = (holder: Pick<RecordLockHolder, "kind" | "id">) => `${holder.kind}:${holder.id}`;

function toView(lock: RecordLock, dependents: readonly RecordLockHolder[], links: Map<string, RecordLockLink>): RecordLockView {
  const resolve = (holders: readonly RecordLockHolder[]) => {
    const resolved = holders.map(holder => links.get(linkKey(holder)) ?? { kind: holder.kind, id: holder.id, label: holder.label ?? null, facilityId: null });
    return [...new Map(resolved.map(link => [linkKey(link), link])).values()];
  };
  const returnedBy = (lock.returnedBy ?? []).flatMap(returned => returned.statements.map(statement => ({
    removal: resolve([{ kind: "removal", id: returned.removalId }])[0],
    statement: resolve([{ kind: "ghgStatement", id: statement.id }])[0],
    statementStatus: statement.status,
  })));
  return { level: lock.level, heldBy: resolve(lock.heldBy), usedBy: resolve(dependents), freeFields: [...lock.freeFields], howToFree: lock.howToFree, returnedBy };
}

/**
 * Codes and facilities for every holder, one query per kind. A stock entry
 * resolves to the delivery or product it posted when there is one; a loss or
 * count has no record of its own and stays a stock entry named by its bin.
 */
export async function resolveRecordLockLinks(ctx: OrgContext, holders: readonly RecordLockHolder[]): Promise<Map<string, RecordLockLink>> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const idsOf = (kind: string) => [...new Set(holders.filter(holder => holder.kind === kind).map(holder => holder.id))];
  const links = new Map<string, RecordLockLink>();
  const put = (key: string, link: RecordLockLink) => links.set(key, link);

  const entryIds = idsOf("stockEntry");
  const entrySources = new Map<string, { kind: string; id: string }>();
  if (entryIds.length) {
    const movements = await db.select({
      id: binMovements.id, outputKind: binMovements.outputKind, inputSnapshot: binMovements.inputSnapshot,
      binName: storageLocations.name, facilityId: storageLocations.facilityId,
    }).from(binMovements)
      .innerJoin(storageLocations, and(eq(storageLocations.id, binMovements.storageLocationId), eq(storageLocations.organizationId, org)))
      .where(and(eq(binMovements.organizationId, org), inArray(binMovements.id, entryIds)));
    const deliveryRows = await db.select({ movementId: outputStockAllocations.movementId, deliveryId: outputStockAllocations.deliveryId })
      .from(outputStockAllocations)
      .where(and(eq(outputStockAllocations.organizationId, org), inArray(outputStockAllocations.movementId, entryIds), isNotNull(outputStockAllocations.deliveryId)));
    for (const movement of movements) {
      const deliveryId = deliveryRows.find(row => row.movementId === movement.id)?.deliveryId;
      const productId = movement.inputSnapshot?.targetBiocharProductId;
      if (deliveryId) entrySources.set(movement.id, { kind: "delivery", id: deliveryId });
      else if (typeof productId === "string") entrySources.set(movement.id, { kind: "biocharProduct", id: productId });
      else put(`stockEntry:${movement.id}`, { kind: "stockEntry", id: movement.id, label: movement.binName, facilityId: movement.facilityId });
    }
  }
  const all = [...holders, ...[...entrySources.values()].map(source => ({ ...source }))];
  const ids = (kind: string) => [...new Set(all.filter(holder => holder.kind === kind).map(holder => holder.id))];

  const coded = async (kind: string, table: typeof productionRuns | typeof biocharProducts | typeof creditBatches | typeof deliveries | typeof feedstocks | typeof orders) => {
    const wanted = ids(kind);
    if (!wanted.length) return;
    const rows = await db.select({ id: table.id, code: table.code, facilityId: table.facilityId }).from(table)
      .where(and(eq(table.organizationId, org), inArray(table.id, wanted)));
    for (const row of rows) put(`${kind}:${row.id}`, { kind, id: row.id, label: row.code, facilityId: row.facilityId });
  };
  await Promise.all([
    coded("productionRun", productionRuns), coded("biocharProduct", biocharProducts), coded("creditBatch", creditBatches),
    coded("delivery", deliveries), coded("feedstock", feedstocks), coded("order", orders),
    (async () => {
      const wanted = ids("application");
      if (!wanted.length) return;
      const rows = await db.select({ id: applications.id, code: applications.code, facilityId: deliveries.facilityId }).from(applications)
        .leftJoin(deliveries, and(eq(deliveries.id, applications.deliveryId), eq(deliveries.organizationId, org)))
        .where(and(eq(applications.organizationId, org), inArray(applications.id, wanted)));
      for (const row of rows) put(`application:${row.id}`, { kind: "application", id: row.id, label: row.code, facilityId: row.facilityId });
    })(),
    (async () => {
      const wanted = ids("sample");
      if (!wanted.length) return;
      const rows = await db.select({ id: samples.id, code: samples.sampleCode, facilityId: creditBatches.facilityId }).from(samples)
        .leftJoin(creditBatches, and(eq(creditBatches.id, samples.creditBatchId), eq(creditBatches.organizationId, org)))
        .where(and(eq(samples.organizationId, org), inArray(samples.id, wanted)));
      for (const row of rows) put(`sample:${row.id}`, { kind: "sample", id: row.id, label: row.code, facilityId: row.facilityId });
    })(),
    (async () => {
      const wanted = ids("ghgStatement");
      if (!wanted.length) return;
      const rows = await db.select({ id: certifierGhgStatements.id, facilityId: certifierGhgStatements.facilityId,
        startOn: certifierGhgStatements.reportingPeriodStartOn, endOn: certifierGhgStatements.reportingPeriodEndOn })
        .from(certifierGhgStatements).where(and(eq(certifierGhgStatements.organizationId, org), inArray(certifierGhgStatements.id, wanted)));
      for (const row of rows) {
        put(`ghgStatement:${row.id}`, { kind: "ghgStatement", id: row.id, label: null, facilityId: row.facilityId,
          period: row.startOn ? { startedOn: row.startOn, completedOn: row.endOn } : null, endsOn: row.endOn });
      }
    })(),
    (async () => {
      const wanted = ids("removal");
      if (!wanted.length) return;
      const rows = await db.select({ id: certifierRemovals.id, facilityId: certifierRemovals.facilityId, startedOn: certifierRemovals.startedOn, completedOn: certifierRemovals.completedOn })
        .from(certifierRemovals).where(and(eq(certifierRemovals.organizationId, org), inArray(certifierRemovals.id, wanted)));
      for (const row of rows) {
        put(`removal:${row.id}`, { kind: "removal", id: row.id, label: null, facilityId: row.facilityId,
          period: row.startedOn && row.completedOn ? { startedOn: row.startedOn, completedOn: row.completedOn } : null });
      }
    })(),
  ]);
  // A stock entry with a source answers as that source.
  for (const [movementId, source] of entrySources) {
    const link = links.get(linkKey(source));
    if (link) links.set(`stockEntry:${movementId}`, link);
  }
  return links;
}
