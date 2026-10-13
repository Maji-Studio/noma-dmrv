/**
 * Operators Data Access Layer: list, read, edit and delete.
 *
 * Creation stays in `quick-add.ts`. An operator names who ran a production
 * run, logged an incident or took an in-process measurement; it never reaches
 * a calculation, so every field is always editable.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { isPgForeignKeyViolation } from "@/db/errors";
import { operators, type Operator } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { formatFleetDeleteBlocker } from "@/lib/fleet/messages";
import { countOperatorUsage } from "./fleet-usage";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const OPERATOR_CONFLICT_ENTITY = "operator";
const OPERATOR_NOT_FOUND = "Operator not found";
const OPERATOR_FK_CONSTRAINTS = [
  "incident_reports_operator_id_operators_id_fk",
  "production_runs_operator_id_operators_id_fk",
  "production_samples_sampled_by_id_operators_id_fk",
] as const;
const OPERATOR_IN_USE =
  "Operator was not deleted because production records still use it. Choose another operator on those records, or keep this one.";

export interface UpdateOperatorData {
  name: string;
  credentials?: string | null;
  contactPhone?: string | null;
}

export async function listOperators(ctx: OrgContext): Promise<Operator[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(operators)
    .where(eq(operators.organizationId, ctx.organizationId))
    .orderBy(asc(operators.name), asc(operators.id));
}

export async function getOperator(ctx: OrgContext, operatorId: string): Promise<Operator | null> {
  requireOrgScope(ctx);
  const [operator] = await db
    .select()
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.organizationId, ctx.organizationId)));
  return operator ?? null;
}

export async function updateOperator(
  ctx: OrgContext,
  operatorId: string,
  data: UpdateOperatorData,
  expectedVersion: number,
): Promise<Operator> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: operators.version })
      .from(operators)
      .where(and(eq(operators.id, operatorId), eq(operators.organizationId, ctx.organizationId)))
      .for("update");
    if (!locked) throw new DomainError("not_found", OPERATOR_NOT_FOUND);
    assertRowVersion({ entity: OPERATOR_CONFLICT_ENTITY, id: operatorId, expectedVersion, actualVersion: locked.version });

    const [updated] = await tx
      .update(operators)
      .set({
        name: data.name,
        credentials: data.credentials ?? null,
        contactPhone: data.contactPhone ?? null,
        version: nextVersion(operators.version),
        updatedAt: new Date(),
      })
      .where(and(eq(operators.id, operatorId), eq(operators.organizationId, ctx.organizationId)))
      .returning();
    return updated;
  });
}

export async function deleteOperator(
  ctx: OrgContext,
  operatorId: string,
  expectedVersion: number,
): Promise<void> {
  requireOrgScope(ctx);
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ version: operators.version })
        .from(operators)
        .where(and(eq(operators.id, operatorId), eq(operators.organizationId, ctx.organizationId)))
        .for("update");
      if (!locked) throw new DomainError("not_found", OPERATOR_NOT_FOUND);
      assertRowVersion({ entity: OPERATOR_CONFLICT_ENTITY, id: operatorId, expectedVersion, actualVersion: locked.version });

      const blocker = formatFleetDeleteBlocker("operator", null, await countOperatorUsage(ctx, tx, operatorId));
      if (blocker) throw new DomainError("conflict", blocker);

      await tx
        .delete(operators)
        .where(and(eq(operators.id, operatorId), eq(operators.organizationId, ctx.organizationId)));
    });
  } catch (error) {
    if (OPERATOR_FK_CONSTRAINTS.some((constraint) => isPgForeignKeyViolation(error, constraint))) {
      throw new DomainError("conflict", OPERATOR_IN_USE);
    }
    throw error;
  }
}
