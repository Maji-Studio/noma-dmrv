import { createProductionSampleInTransaction, type ProductionSampleWithRelations } from "@/data-access/production-samples";
import { createProductionSampleSchema } from "@/schemas/production-samples";
import type { Operation } from "./runner";

export const recordProductionSample: Operation<typeof createProductionSampleSchema, ProductionSampleWithRelations> = {
  id: "record_production_sample",
  input: createProductionSampleSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => createProductionSampleInTransaction(ctx, tx, {
    productionRunId: input.productionRunId,
    timestamp: input.timestamp,
    weightGrams: input.weightGrams ?? null,
    volumeMl: input.volumeMl ?? null,
    temperatureC: input.temperatureC ?? null,
    moistureContentPercent: input.moistureContentPercent ?? null,
    fixedCarbonPercent: input.fixedCarbonPercent ?? null,
    volatileMatterPercent: input.volatileMatterPercent ?? null,
    ashContentPercent: input.ashContentPercent ?? null,
    photoUrl: input.photoUrl || null,
    sampledById: input.sampledById ?? null,
    notes: input.notes ?? null,
  }),
};
