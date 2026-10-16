import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { facilities, feedstockTypes, formulationIngredients, formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";

const FACILITY_NOT_FOUND_MESSAGE = "Facility not found or archived";
const FORMULATION_NOT_FOUND_MESSAGE = "Formulation not found";

/** One formulation line with the material it names, as a product composition snapshots it. */
export interface ProductFormulationLine {
  id: string;
  feedstockTypeId: string;
  feedstockTypeName: string;
  feedstockTypeCategory: string;
  ratio: number | null;
}

function referenceNotFound(message: string, field: string): DomainError {
  return new DomainError("not_found", message, { issues: [{ path: [field], code: "not_found", message }] });
}

/** The live facility a product is placed at, with the zone a facility-local time is read in. */
export async function readProductFacility(ctx: OrgContext, tx: DbTransaction, facilityId: string): Promise<{ id: string; timeZone: string }> {
  requireOrgScope(ctx);
  const [facility] = await tx.select({ id: facilities.id, timeZone: facilities.timezone }).from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId), isNull(facilities.archivedAt)));
  if (!facility) throw referenceNotFound(FACILITY_NOT_FOUND_MESSAGE, "facilityId");
  return facility;
}

/** A formulation's lines in recipe order. A missing or foreign formulation is not found. */
export async function readProductFormulationLines(ctx: OrgContext, tx: DbTransaction, formulationId: string): Promise<ProductFormulationLine[]> {
  requireOrgScope(ctx);
  const [formulation] = await tx.select({ id: formulations.id }).from(formulations)
    .where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, formulationId)));
  if (!formulation) throw referenceNotFound(FORMULATION_NOT_FOUND_MESSAGE, "formulationId");
  return tx.select({
    id: formulationIngredients.id, feedstockTypeId: formulationIngredients.feedstockTypeId, ratio: formulationIngredients.ratio,
    feedstockTypeName: feedstockTypes.name, feedstockTypeCategory: feedstockTypes.category,
  }).from(formulationIngredients)
    .innerJoin(feedstockTypes, and(eq(feedstockTypes.organizationId, ctx.organizationId), eq(feedstockTypes.id, formulationIngredients.feedstockTypeId)))
    .where(and(eq(formulationIngredients.organizationId, ctx.organizationId), eq(formulationIngredients.formulationId, formulationId)))
    .orderBy(asc(formulationIngredients.sortOrder), asc(formulationIngredients.id));
}

/** Enrich operator facts only after the product writer holds the formulation share lock. */
export async function resolveProductComposition(ctx: OrgContext, tx: DbTransaction, formulationId: string, composition: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  requireOrgScope(ctx);
  const lines = await readProductFormulationLines(ctx, tx, formulationId);
  const ingredients = (composition?.ingredients ?? []) as Record<string, unknown>[];
  const rows = ingredients.map((ingredient, index) => {
    const line = lines.find(candidate => candidate.id === ingredient.formulationIngredientId);
    if (!line) {
      const message = "This ingredient is not part of the chosen formulation.";
      throw new DomainError("validation_failed", message, { issues: [{ path: ["ingredients", index, "formulationIngredientId"], code: "validation_failed", message }] });
    }
    return { ...ingredient, formulationIngredientId: line.id, feedstockTypeId: line.feedstockTypeId, feedstockTypeName: line.feedstockTypeName, feedstockTypeCategory: line.feedstockTypeCategory, ratio: line.ratio };
  });
  if (lines.some(line => !ingredients.some(ingredient => ingredient.formulationIngredientId === line.id))) {
    const message = "Enter a mass for every ingredient of the formulation, 0 kg for one not used.";
    throw new DomainError("validation_failed", message, { issues: [{ path: ["ingredients"], code: "validation_failed", message }] });
  }
  rows.sort((a, b) => lines.findIndex(line => line.id === a.formulationIngredientId) - lines.findIndex(line => line.id === b.formulationIngredientId));
  return rows.length ? { ...composition, ingredients: rows } : {};
}
