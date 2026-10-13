import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { facilities, formulationIngredients, formulations, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export type ProductReferenceKind = "facility" | "formulation" | "storageLocation" | "formulationIngredient";

export interface ProductReference {
  kind: ProductReferenceKind;
  id: string;
  /** Where the request named it, as an input path. */
  path: (string | number)[];
}

/**
 * The first reference, in the order given, that names no row of this
 * organization. An archived row still exists here: the write's own guards
 * refuse it with the reason. One statement per kind, all in `tx`.
 */
export async function findMissingProductReference(ctx: OrgContext, tx: DbTransaction, references: readonly ProductReference[]): Promise<ProductReference | null> {
  requireOrgScope(ctx);
  const idsOf = (kind: ProductReferenceKind) => [...new Set(references.filter((reference) => reference.kind === kind).map((reference) => reference.id))];
  const [facilityIds, formulationIds, binIds, lineIds] = (["facility", "formulation", "storageLocation", "formulationIngredient"] as const).map(idsOf);
  const found = new Set<string>();
  const remember = (kind: ProductReferenceKind, rows: { id: string }[]) => rows.forEach((row) => found.add(`${kind}:${row.id}`));
  if (facilityIds.length) remember("facility", await tx.select({ id: facilities.id }).from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), inArray(facilities.id, facilityIds))));
  if (formulationIds.length) remember("formulation", await tx.select({ id: formulations.id }).from(formulations)
    .where(and(eq(formulations.organizationId, ctx.organizationId), inArray(formulations.id, formulationIds))));
  if (binIds.length) remember("storageLocation", await tx.select({ id: storageLocations.id }).from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, binIds))));
  if (lineIds.length) remember("formulationIngredient", await tx.select({ id: formulationIngredients.id }).from(formulationIngredients)
    .where(and(eq(formulationIngredients.organizationId, ctx.organizationId), inArray(formulationIngredients.id, lineIds))));
  return references.find((reference) => !found.has(`${reference.kind}:${reference.id}`)) ?? null;
}
