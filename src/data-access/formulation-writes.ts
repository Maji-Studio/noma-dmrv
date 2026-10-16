/**
 * Formulation write lock order:
 * Create: feedstock types FOR SHARE in id order (org, existence, blend usage,
 * active), then withAutoCodes BCF savepoint inserting parent and lines; tx readback.
 * Update: formulation FOR UPDATE and version, incoming types FOR SHARE in id
 * order (retained archived types pass), existing lines FOR UPDATE in id order,
 * plain removed-line snapshot/product references (first five codes), merged
 * millionths total, then withUniqueCodeGuard update and line reconciliation.
 * Delete: formulation FOR UPDATE and version, plain product/bin/order references
 * including archived rows, then delete with cascading lines.
 * Archive/restore: formulation FOR UPDATE, version, state, then guarded update.
 * Bin new claims: existing facility/bin locks, formulation FOR SHARE held through
 * the write. Kept claims skip it. Products read lines after formulation FOR SHARE.
 * Type usage update: type FOR UPDATE, plain formulation-line usage read; no
 * formulation lock. Formulation writers never request facility, bin, product or
 * order locks, so they cannot reverse those writers' or facility archive's order.
 */
import { and, asc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProducts,
  feedstockTypes,
  formulationIngredients,
  formulations,
  orders,
  productIngredientSnapshots,
  storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  formulationInUse,
  formulationArchivedForEdit,
  formulationArchiveConflict,
  formulationLineInUse,
  formulationNotFound,
  formulationRatioExceeded,
  formulationTypeNotBlend,
  formulationTypeNotFound,
} from "@/lib/formulation-domain-errors";
import { exceedsFormulationRatioSum } from "@/lib/formulation-ratios";
import {
  createFormulationInput,
  updateFormulationInput,
  type CreateFormulationInput,
  type UpdateFormulationInput,
  type FormulationVersionInput,
} from "@/schemas/formulation-input";
import { validationFailed } from "@/lib/operations/errors";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import type { FormulationWithIngredients } from "./formulations";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const BLOCKER_LIMIT = 5;
type Lines = NonNullable<CreateFormulationInput["lines"]>;

/** Lock before code generation; the insert primitive repeats this for direct callers. */
export async function lockFormulationTypes(
  ctx: OrgContext,
  tx: DbTransaction,
  lines: Lines = [],
  retained: ReadonlySet<string> = new Set(),
): Promise<void> {
  requireOrgScope(ctx);
  const ids = [...new Set(lines.map(line => line.feedstockTypeId))].sort();
  if (!ids.length) return;
  const types = await tx.select().from(feedstockTypes)
    .where(and(eq(feedstockTypes.organizationId, ctx.organizationId), inArray(feedstockTypes.id, ids)))
    .orderBy(asc(feedstockTypes.id)).for("share");
  for (const [index, line] of lines.entries()) {
    const type = types.find(type => type.id === line.feedstockTypeId);
    if (!type || (type.archivedAt && !retained.has(type.id))) throw formulationTypeNotFound(index);
    if (type.usage !== "blend") throw formulationTypeNotBlend(index);
  }
}
async function readBack(ctx: OrgContext, tx: DbTransaction, id: string): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);
  const row = await tx.query.formulations.findFirst({
    where: and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, id)),
    with: { ingredients: {
      where: eq(formulationIngredients.organizationId, ctx.organizationId),
      orderBy: [asc(formulationIngredients.sortOrder)],
      with: { feedstockType: true },
    } },
  });
  if (!row) throw formulationNotFound();
  return row;
}
export async function createFormulationInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  input: CreateFormulationInput & { code: string },
): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);
  const { code, ...body } = input;
  const parsed = createFormulationInput.safeParse(body);
  if (!parsed.success) throw validationFailed(parsed.error);
  const data = parsed.data;
  await lockFormulationTypes(ctx, tx, data.lines);
  const [row] = await tx.insert(formulations).values({
    organizationId: ctx.organizationId, code, name: data.name,
    biocharRatio: data.biocharRatio ?? null, description: data.description ?? null,
  }).returning();
  if (data.lines?.length) {
    await tx.insert(formulationIngredients).values(data.lines.map((line, sortOrder) => ({
      organizationId: ctx.organizationId, formulationId: row.id,
      feedstockTypeId: line.feedstockTypeId, ratio: line.ratio ?? null, sortOrder,
    })));
  }
  return readBack(ctx, tx, row.id);
}
export async function updateFormulationInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  input: UpdateFormulationInput,
): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);
  const parsed = updateFormulationInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { formulationId, expectedVersion, lines, ...fields } = parsed.data;
  const [locked] = await tx.select().from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId))).for("update");
  if (!locked) throw formulationNotFound();
  if (locked.archivedAt) throw formulationArchivedForEdit(locked.code);
  assertRowVersion({ entity: "formulation", id: formulationId, expectedVersion, actualVersion: locked.version });
  // Parent lock stabilizes this discovery before taking type locks.
  const stored = await tx.select().from(formulationIngredients).where(and(eq(formulationIngredients.organizationId, ctx.organizationId), eq(formulationIngredients.formulationId, formulationId)));
  await lockFormulationTypes(ctx, tx, lines, new Set(stored.map(line => line.feedstockTypeId)));
  const existing = await tx.select().from(formulationIngredients).where(and(eq(formulationIngredients.organizationId, ctx.organizationId), eq(formulationIngredients.formulationId, formulationId))).orderBy(asc(formulationIngredients.id)).for("update");
  const removed = lines === undefined ? []
    : existing.filter(line => !lines.some(incoming => incoming.feedstockTypeId === line.feedstockTypeId));
  for (const line of removed) {
    const products = await tx.selectDistinct({ code: biocharProducts.code }).from(productIngredientSnapshots)
      .innerJoin(biocharProducts, and(
        eq(biocharProducts.id, productIngredientSnapshots.biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId),
      ))
      .where(and(
        eq(productIngredientSnapshots.organizationId, ctx.organizationId), eq(productIngredientSnapshots.formulationIngredientId, line.id),
      ))
      .orderBy(asc(biocharProducts.code)).limit(BLOCKER_LIMIT);
    if (products.length) throw formulationLineInUse(line.id, line.feedstockTypeId, products.map(row => row.code));
  }
  if (exceedsFormulationRatioSum(
    fields.biocharRatio === undefined ? locked.biocharRatio : fields.biocharRatio, lines ?? existing,
  )) throw formulationRatioExceeded();
  return withUniqueCodeGuard(ctx, formulations, formulations.code, CODE_CONFLICT_MESSAGES.formulation, async () => {
    await tx.update(formulations)
      .set({ ...fields, version: nextVersion(formulations.version), updatedAt: new Date() }).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId)));
    if (lines !== undefined) {
      for (const [sortOrder, line] of lines.entries()) {
        const retained = existing.find(old => old.feedstockTypeId === line.feedstockTypeId);
        if (retained) {
          await tx.update(formulationIngredients).set({ ratio: line.ratio ?? null, sortOrder })
            .where(and(eq(formulationIngredients.organizationId, ctx.organizationId), eq(formulationIngredients.formulationId, formulationId), eq(formulationIngredients.id, retained.id)));
        } else {
          await tx.insert(formulationIngredients).values({
            organizationId: ctx.organizationId, formulationId,
            feedstockTypeId: line.feedstockTypeId, ratio: line.ratio ?? null, sortOrder,
          });
        }
      }
      if (removed.length) {
        await tx.delete(formulationIngredients)
          .where(and(eq(formulationIngredients.organizationId, ctx.organizationId), eq(formulationIngredients.formulationId, formulationId), inArray(formulationIngredients.id, removed.map(line => line.id))));
      }
    }
    return readBack(ctx, tx, formulationId);
  });
}
export async function deleteFormulationInTransaction(ctx: OrgContext, tx: DbTransaction, input: FormulationVersionInput): Promise<void> {
  requireOrgScope(ctx);
  const { formulationId, expectedVersion } = input;
  const [locked] = await tx.select().from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId))).for("update");
  if (!locked) throw formulationNotFound();
  assertRowVersion({ entity: "formulation", id: formulationId, expectedVersion, actualVersion: locked.version });
  const products = await tx.select({ code: biocharProducts.code }).from(biocharProducts)
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.formulationId, formulationId)))
    .orderBy(asc(biocharProducts.code)).limit(BLOCKER_LIMIT);
  if (products.length) throw formulationInUse("biochar products", products.map(row => row.code));
  const bins = await tx.select({ code: storageLocations.code }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.formulationId, formulationId)))
    .orderBy(asc(storageLocations.code)).limit(BLOCKER_LIMIT);
  if (bins.length) throw formulationInUse("product bins", bins.map(row => row.code));
  const uses = await tx.select({ code: orders.code }).from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.formulationId, formulationId)))
    .orderBy(asc(orders.code)).limit(BLOCKER_LIMIT);
  if (uses.length) throw formulationInUse("orders", uses.map(row => row.code));
  await tx.delete(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId)));
}

/** Only the formulation row is locked; no referencing rows or types are locked. */
async function changeFormulationArchiveState(
  ctx: OrgContext,
  tx: DbTransaction,
  { formulationId, expectedVersion }: FormulationVersionInput,
  archive: boolean,
): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);
  // Explicit UPDATE strength also serializes with reference SHARE locks.
  const [locked] = await tx.select().from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId))).for("update");
  if (!locked) throw formulationNotFound();
  assertRowVersion({ entity: "formulation", id: formulationId, expectedVersion, actualVersion: locked.version });
  if (Boolean(locked.archivedAt) === archive) throw formulationArchiveConflict(locked.code, archive);
  const [saved] = await tx.update(formulations).set({
    archivedAt: archive ? sql`now()` : null,
    version: nextVersion(formulations.version), updatedAt: sql`now()`,
  }).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId), archive ? isNull(formulations.archivedAt) : isNotNull(formulations.archivedAt))).returning();
  if (!saved) throw formulationArchiveConflict(locked.code, archive);
  return readBack(ctx, tx, formulationId);
}

export async function archiveFormulationInTransaction(ctx: OrgContext, tx: DbTransaction, input: FormulationVersionInput): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);
  return changeFormulationArchiveState(ctx, tx, input, true);
}

export async function restoreFormulationInTransaction(ctx: OrgContext, tx: DbTransaction, input: FormulationVersionInput): Promise<FormulationWithIngredients> {
  requireOrgScope(ctx);
  return changeFormulationArchiveState(ctx, tx, input, false);
}
