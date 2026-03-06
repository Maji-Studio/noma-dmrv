/**
 * Production Incidents Data Access Layer
 * CRUD operations for incident reports associated with production runs
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { incidentReports, operators, reactors, productionRuns } from "@/db/schema";
import { requireAuth } from "./utils";

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
} as const;

export async function getProductionIncidents(
  userId: string,
  productionRunId: string
): Promise<ProductionIncidentWithRelations[]> {
  requireAuth(userId);

  return db
    .select(incidentSelect)
    .from(incidentReports)
    .leftJoin(operators, eq(incidentReports.operatorId, operators.id))
    .leftJoin(reactors, eq(incidentReports.reactorId, reactors.id))
    .where(eq(incidentReports.productionRunId, productionRunId))
    .orderBy(asc(incidentReports.incidentTime));
}

export async function getProductionIncidentById(
  userId: string,
  id: string
): Promise<ProductionIncidentWithRelations> {
  requireAuth(userId);

  const rows = await db
    .select(incidentSelect)
    .from(incidentReports)
    .leftJoin(operators, eq(incidentReports.operatorId, operators.id))
    .leftJoin(reactors, eq(incidentReports.reactorId, reactors.id))
    .where(eq(incidentReports.id, id));

  if (rows.length === 0) {
    throw new Error("Production incident not found");
  }

  return rows[0];
}

export async function createProductionIncident(
  userId: string,
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
  requireAuth(userId);

  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, data.productionRunId));

  if (!run) {
    throw new Error("Production run not found");
  }

  const [inserted] = await db
    .insert(incidentReports)
    .values({
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

  return getProductionIncidentById(userId, inserted.id);
}

export async function updateProductionIncident(
  userId: string,
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
  requireAuth(userId);

  const [existing] = await db
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(eq(incidentReports.id, id));

  if (!existing) {
    throw new Error("Production incident not found");
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
    .where(eq(incidentReports.id, id));

  return getProductionIncidentById(userId, id);
}

export async function deleteProductionIncident(
  userId: string,
  id: string
): Promise<void> {
  requireAuth(userId);

  const deleted = await db
    .delete(incidentReports)
    .where(eq(incidentReports.id, id))
    .returning({ id: incidentReports.id });

  if (deleted.length === 0) {
    throw new Error("Production incident not found");
  }
}
