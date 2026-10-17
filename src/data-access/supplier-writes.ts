/**
 * Supplier write lock order:
 * Create: named facilities FOR SHARE in id order, then withAutoCodes savepoint:
 * parent with name guard, locations in input order (last explicit default wins,
 * otherwise index zero), pairs and tx readback. New parents have no intakes,
 * so pair filling takes no downstream row locks.
 * Update: parent FOR NO KEY UPDATE for metadata, FOR UPDATE for a supplied code,
 * version, code and name guards, update. Children are untouched.
 * Archive/restore: only the parent FOR UPDATE, no child/reference locks.
 * Explicit UPDATE strength conflicts with reference KEY SHARE; no locks follow it,
 * so archive cannot cycle with intake/order, location, update or delete writers.
 * Delete: parent FOR UPDATE, version, intake check, delete children then parent.
 * Intakes lock facility SHARE, supplier KEY SHARE, then the intake row.
 * Deletes never lock referencing intakes.
 * Pair saves take facility then parent locks. Creates fill only new parents;
 * updates and deletes never request facility or downstream locks, so no reverse
 * edge is introduced against pair writers, facility archive or formulation writes.
 */
import type { CaptureActivity } from "@/lib/activity-changes";
import { and, asc, isNull, isNotNull, sql, eq } from "drizzle-orm";
import { isPgForeignKeyViolation } from "@/db/errors";
import type { DbTransaction } from "@/db";
import { feedstocks, suppliers, supplierLocations, type Supplier, type SupplierLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { partyNotFound, partyArchivedForEdit, partyArchiveConflict, partyRefusal, supplierHasIntakes } from "@/lib/party-domain-errors";
import { createSupplierInput, updateSupplierInput, type CreateSupplierInput, type UpdateSupplierInput, type SupplierVersionInput } from "@/schemas/supplier-input";
import { validationFailed } from "@/lib/operations/errors";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import { guardSupplierName } from "./unique-name-guards";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockPartyFacilities } from "./party-reference-guards";
import { withLocationFacilityDistances } from "./location-facility-distances";
import { requireOrgScope } from "./utils";
import { createSupplierLocationInTransaction } from "./supplier-location-writes";
export { createSupplierLocationInTransaction } from "./supplier-location-writes";

import { BLOCKER_LIMIT } from "@/config/party-input";

export interface CreatedSupplierWithLocations {
  supplier: Supplier;
  locations: SupplierLocation[];
}
export async function createSupplierInTransaction(ctx: OrgContext, tx: DbTransaction, input: CreateSupplierInput & { code: string }, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<CreatedSupplierWithLocations> {
  requireOrgScope(ctx);
  const { code, ...body } = input;
  const parsed = createSupplierInput.safeParse(body);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { locations, ...fields } = parsed.data;
  await lockPartyFacilities(ctx, tx, locations);
  // Code violations remain raw so withAutoCodes can roll back and retry its savepoint.
  const [parent] = await guardSupplierName(ctx, tx, fields.name, savepoint => savepoint.insert(suppliers).values({
    ...fields, code, organizationId: ctx.organizationId, userId: ctx.userId,
  }).returning());
  const inserted: SupplierLocation[] = [];
  for (const location of locations) {
    inserted.push((await createSupplierLocationInTransaction(ctx, tx, parent.id, location)).location);
  }
  const saved = await tx.select().from(supplierLocations).where(and(eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, parent.id)));
  const enriched = await withLocationFacilityDistances(ctx, "supplier", saved, tx);
  capture?.(parent.id, null, parent);
  for (const row of inserted) {
    captureLocation?.(row.id, null, row);
    const final = enriched.find(saved => saved.id === row.id)!;
    if (final.version !== row.version) captureLocation?.(row.id, row, final);
  }
  return { supplier: parent, locations: inserted.map(row => enriched.find(saved => saved.id === row.id)!) };
}

export async function updateSupplierInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateSupplierInput, capture?: CaptureActivity): Promise<Supplier> {
  requireOrgScope(ctx);
  const parsed = updateSupplierInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { supplierId, expectedVersion, ...fields } = parsed.data;
  const [locked] = await tx.select().from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId)))
    .for(fields.code === undefined ? "no key update" : "update");
  if (!locked) throw partyNotFound("supplier");
  if (locked.archivedAt) throw partyArchivedForEdit("supplier", locked.code);
  assertRowVersion({ entity: "supplier", id: supplierId, expectedVersion, actualVersion: locked.version });
  return withUniqueCodeGuard(ctx, suppliers, suppliers.code, CODE_CONFLICT_MESSAGES.supplier, () =>
    guardSupplierName(ctx, tx, fields.name ?? locked.name, async savepoint => {
      const [saved] = await savepoint.update(suppliers).set({ ...fields, version: nextVersion(suppliers.version), updatedAt: new Date() })
        .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId))).returning();
      capture?.(saved.id, locked, saved);
      return saved;
    }));
}
/** Return deleted locations so the operation can record each child event. */
export async function deleteSupplierInTransaction(ctx: OrgContext, tx: DbTransaction, input: SupplierVersionInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<(typeof supplierLocations.$inferSelect)[]> {
  requireOrgScope(ctx);
  const { supplierId, expectedVersion } = input;
  const [locked] = await tx.select().from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId))).for("update");
  if (!locked) throw partyNotFound("supplier");
  assertRowVersion({ entity: "supplier", id: supplierId, expectedVersion, actualVersion: locked.version });
  const uses = await tx.select({ code: feedstocks.code }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.supplierId, supplierId)))
    .orderBy(asc(feedstocks.code)).limit(BLOCKER_LIMIT);
  if (uses.length) throw supplierHasIntakes(uses.map(row => row.code));
  const children = await tx.select().from(supplierLocations).where(and(eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, supplierId)))
    .orderBy(asc(supplierLocations.id)).for("update");
  try {
    await tx.delete(supplierLocations).where(and(eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, supplierId)));
    await tx.delete(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId))).returning({ id: suppliers.id });
  } catch (error) {
    if (isPgForeignKeyViolation(error, "feedstocks_supplier_id_suppliers_id_fk")) throw supplierHasIntakes();
    if (isPgForeignKeyViolation(error, "supplier_locations_supplier_id_suppliers_id_fk")) throw partyRefusal("conflict", "Cannot delete this supplier because it has linked locations. Refresh and try again.", ["supplierId"]);
    throw error;
  }
  capture?.(locked.id, locked, null);
  for (const child of children) captureLocation?.(child.id, child, null);
  return children;
}

/** Lock only the party, including against reference KEY SHARE locks. */
async function changeSupplierArchiveState(
  ctx: OrgContext,
  tx: DbTransaction,
  { supplierId, expectedVersion }: SupplierVersionInput,
  archive: boolean,
  capture?: CaptureActivity,
): Promise<Supplier> {
  requireOrgScope(ctx);
  const [locked] = await tx.select().from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId))).for("update");
  if (!locked) throw partyNotFound("supplier");
  assertRowVersion({ entity: "supplier", id: supplierId, expectedVersion, actualVersion: locked.version });
  if (Boolean(locked.archivedAt) === archive) throw partyArchiveConflict("supplier", locked.code, archive);
  const [saved] = await tx.update(suppliers).set({
    archivedAt: archive ? sql`now()` : null,
    version: nextVersion(suppliers.version), updatedAt: sql`now()`,
  }).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId), archive ? isNull(suppliers.archivedAt) : isNotNull(suppliers.archivedAt))).returning();
  if (!saved) throw partyArchiveConflict("supplier", locked.code, archive);
  capture?.(saved.id, locked, locked);
  return saved;
}

export async function archiveSupplierInTransaction(ctx: OrgContext, tx: DbTransaction, input: SupplierVersionInput, capture?: CaptureActivity): Promise<Supplier> {
  requireOrgScope(ctx);
  return changeSupplierArchiveState(ctx, tx, input, true, capture);
}

export async function restoreSupplierInTransaction(ctx: OrgContext, tx: DbTransaction, input: SupplierVersionInput, capture?: CaptureActivity): Promise<Supplier> {
  requireOrgScope(ctx);
  return changeSupplierArchiveState(ctx, tx, input, false, capture);
}
