/**
 * Production Incidents Data Access Layer
 * CRUD operations for incident reports associated with production runs
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { incidentReports, operators, reactors, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { retireDocumentsForEntities } from "./documents";

export interface ProductionIncidentWithRelations {
  id: string;
  productionRunId: string;
  incidentTime: Date;
  incidentDate: Date;
  operatorId: string | null;
  reactorId: string | null;
  description: string;
  severity: "low" | "medium" | "high" | null;
  correctiveActions: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  operatorName: string | null;
  reactorCode: string | null;
  reactorIdentifier: string | null;
}

const incidentSelect = {
  id: incidentReports.id,
  productionRunId: incidentReports.productionRunId,
  incidentTime: incidentReports.incidentTime,
  incidentDate: incidentReports.incidentDate,
  operatorId: incidentReports.operatorId,
  reactorId: incidentReports.reactorId,
  description: incidentReports.description,
  severity: incidentReports.severity,
  correctiveActions: incidentReports.correctiveActions,
  notes: incidentReports.notes,
  createdAt: incidentReports.createdAt,
  updatedAt: incidentReports.updatedAt,
  operatorName: operators.name,
  reactorCode: reactors.code,
  reactorIdentifier: reactors.identifier,
} as const;

export async function getProductionIncidents(
  ctx: OrgContext,
  productionRunId: string
): Promise<ProductionIncidentWithRelations[]> {
  requireOrgScope(ctx);

  return db
    .select(incidentSelect)
    .from(incidentReports)
    .leftJoin(operators, and(eq(incidentReports.operatorId, operators.id), eq(operators.organizationId, ctx.organizationId)))
    .leftJoin(reactors, and(eq(incidentReports.reactorId, reactors.id), eq(reactors.organizationId, ctx.organizationId)))
    .where(and(eq(incidentReports.productionRunId, productionRunId), eq(incidentReports.organizationId, ctx.organizationId)))
    .orderBy(asc(incidentReports.incidentTime));
}

export async function getProductionIncidentById(
  ctx: OrgContext,
  id: string
): Promise<ProductionIncidentWithRelations> {
  requireOrgScope(ctx);

  const rows = await db
    .select(incidentSelect)
    .from(incidentReports)
    .leftJoin(operators, and(eq(incidentReports.operatorId, operators.id), eq(operators.organizationId, ctx.organizationId)))
    .leftJoin(reactors, and(eq(incidentReports.reactorId, reactors.id), eq(reactors.organizationId, ctx.organizationId)))
    .where(and(eq(incidentReports.id, id), eq(incidentReports.organizationId, ctx.organizationId)));

  if (rows.length === 0) {
    throw new SafeError("Production incident not found");
  }

  return rows[0];
}

export async function createProductionIncident(
  ctx: OrgContext,
  data: {
    productionRunId: string;
    incidentTime: Date;
    operatorId?: string | null;
    reactorId?: string | null;
    description: string;
    severity: "low" | "medium" | "high";
    correctiveActions?: string | null;
    notes?: string | null;
  }
): Promise<ProductionIncidentWithRelations> {
  requireOrgScope(ctx);

  if (data.operatorId) await assertSameOrg(ctx, operators, data.operatorId);
  if (data.reactorId) await assertSameOrg(ctx, reactors, data.reactorId);

  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, data.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!run) {
    throw new SafeError("Production run not found");
  }

  const [inserted] = await db
    .insert(incidentReports)
    .values({
      organizationId: ctx.organizationId,
      productionRunId: data.productionRunId,
      incidentTime: data.incidentTime,
      incidentDate: data.incidentTime,
      operatorId: data.operatorId ?? null,
      reactorId: data.reactorId ?? null,
      description: data.description,
      severity: data.severity,
      correctiveActions: data.correctiveActions ?? null,
      notes: data.notes ?? null,
    })
    .returning({ id: incidentReports.id });

  return getProductionIncidentById(ctx, inserted.id);
}

export async function updateProductionIncident(
  ctx: OrgContext,
  id: string,
  data: {
    incidentTime?: Date;
    operatorId?: string | null;
    reactorId?: string | null;
    description?: string;
    severity?: "low" | "medium" | "high";
    correctiveActions?: string | null;
    notes?: string | null;
  }
): Promise<ProductionIncidentWithRelations> {
  requireOrgScope(ctx);

  if (data.operatorId) await assertSameOrg(ctx, operators, data.operatorId);
  if (data.reactorId) await assertSameOrg(ctx, reactors, data.reactorId);

  const [existing] = await db
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(and(eq(incidentReports.id, id), eq(incidentReports.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Production incident not found");
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.incidentTime !== undefined) {
    updateData.incidentTime = data.incidentTime;
    updateData.incidentDate = data.incidentTime;
  }
  if (data.operatorId !== undefined) updateData.operatorId = data.operatorId;
  if (data.reactorId !== undefined) updateData.reactorId = data.reactorId;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.severity !== undefined) updateData.severity = data.severity;
  if (data.correctiveActions !== undefined) {
    updateData.correctiveActions = data.correctiveActions;
  }
  if (data.notes !== undefined) updateData.notes = data.notes;

  await db
    .update(incidentReports)
    .set(updateData)
    .where(and(eq(incidentReports.id, id), eq(incidentReports.organizationId, ctx.organizationId)));

  return getProductionIncidentById(ctx, id);
}

export async function deleteProductionIncident(
  ctx: OrgContext,
  id: string
): Promise<void> {
  requireOrgScope(ctx);

  const deleted = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(incidentReports)
      .where(and(eq(incidentReports.id, id), eq(incidentReports.organizationId, ctx.organizationId)))
      .returning({ id: incidentReports.id });
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "production_incident", entityId: id },
    ]);
    return rows;
  });

  if (deleted.length === 0) {
    throw new SafeError("Production incident not found");
  }
}
