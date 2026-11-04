import { createProductionIncidentInTransaction, type ProductionIncidentWithRelations } from "@/data-access/production-incidents";
import { createProductionIncidentSchema } from "@/schemas/production-incidents";
import type { Operation } from "./runner";

export const recordProductionIncident: Operation<typeof createProductionIncidentSchema, ProductionIncidentWithRelations> = {
  id: "record_production_incident",
  input: createProductionIncidentSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => createProductionIncidentInTransaction(ctx, tx, {
    productionRunId: input.productionRunId,
    incidentTime: input.incidentTime,
    operatorId: input.operatorId ?? null,
    reactorId: input.reactorId ?? null,
    description: input.description,
    severity: input.severity,
    correctiveActions: input.correctiveActions || null,
    notes: input.notes || null,
  }),
};
