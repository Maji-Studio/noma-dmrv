import { z } from "zod";
import { PRODUCTION_RUN_STATUSES } from "@/lib/production-runs/lifecycle";

export const productionRunRepresentationSchema = z.object({
  id: z.uuid().describe("Production run identifier, UUID."),
  code: z.string().describe("Human-readable production run code."),
  version: z.number().int().positive().describe("Positive row version for concurrency checks."),
  facilityId: z.uuid().describe("Owning facility identifier, UUID."),
  facilityCode: z.string().describe("Owning facility code."),
  timeZone: z.string().describe("IANA facility time zone for interpreting local date/time input."),
  reactorId: z.uuid().describe("Reactor identifier, UUID."),
  reactorCode: z.string().describe("Reactor code."),
  status: z.enum(PRODUCTION_RUN_STATUSES).describe("Run status; change it through update_production_run."),
  cancellationReason: z.string().nullable().describe("Cancellation reason, untrusted plain text, or null."),
  startTime: z.iso.datetime().describe("Start instant in UTC, RFC 3339."),
  endTime: z.iso.datetime().nullable().describe("End instant in UTC, RFC 3339, or null for an open run."),
  operatorId: z.uuid().nullable().describe("Operator identifier, UUID, or null."),
  feedstockDraws: z.array(z.object({ storageLocationId: z.uuid().describe("Source feedstock bin UUID."), storageLocationCode: z.string().describe("Source bin code."), wetMassKg: z.number().describe("Wet mass drawn from the bin in kilograms.") })).describe("Explicit bin withdrawals; excludes internal feedstock allocations."),
  feedstockMoisturePercent: z.number().nullable().describe("Feedstock moisture as percent of wet mass, 0 to 100."),
  feedingRateKgHr: z.number().nullable().describe("Feed rate in kilograms per hour."),
  residenceTimeMinutes: z.number().nullable().describe("Residence time in minutes."),
  dieselOperationLiters: z.number().nullable().describe("Operational diesel in litres."),
  dieselGensetLiters: z.number().nullable().describe("Generator diesel in litres."),
  preprocessingFuelLiters: z.number().nullable().describe("Preprocessing fuel in litres."),
  electricityKwh: z.number().nullable().describe("Electricity in kilowatt hours."),
  biocharOutputKg: z.number().nullable().describe("Wet biochar output in kilograms."),
  biocharMoisturePercent: z.number().nullable().describe("Biochar moisture as percent of wet mass, 0 to 100."),
  biocharStorageLocationId: z.uuid().nullable().describe("Output bin identifier, UUID, or null."),
  biocharStorageLocationCode: z.string().nullable().describe("Output bin code, or null."),
  createdAt: z.iso.datetime().describe("Creation instant in UTC, RFC 3339."),
  updatedAt: z.iso.datetime().describe("Last update instant in UTC, RFC 3339."),
});
export type ProductionRunRepresentation = z.infer<typeof productionRunRepresentationSchema>;
export type ProductionRunRepresentationInput = Omit<ProductionRunRepresentation, "startTime" | "endTime" | "createdAt" | "updatedAt"> & {
  startTime: Date | string; endTime: Date | string | null; createdAt: Date | string; updatedAt: Date | string;
};

/** Explicit public projection for database reads and stored JSON outcomes. */
export function representProductionRun(row: ProductionRunRepresentationInput): ProductionRunRepresentation {
  return productionRunRepresentationSchema.parse({
    id: row.id,
    code: row.code,
    version: row.version,
    facilityId: row.facilityId,
    facilityCode: row.facilityCode,
    timeZone: row.timeZone,
    reactorId: row.reactorId,
    reactorCode: row.reactorCode,
    status: row.status,
    cancellationReason: row.cancellationReason,
    operatorId: row.operatorId,
    feedstockMoisturePercent: row.feedstockMoisturePercent,
    feedingRateKgHr: row.feedingRateKgHr,
    residenceTimeMinutes: row.residenceTimeMinutes,
    dieselOperationLiters: row.dieselOperationLiters,
    dieselGensetLiters: row.dieselGensetLiters,
    preprocessingFuelLiters: row.preprocessingFuelLiters,
    electricityKwh: row.electricityKwh,
    biocharOutputKg: row.biocharOutputKg,
    biocharMoisturePercent: row.biocharMoisturePercent,
    biocharStorageLocationId: row.biocharStorageLocationId,
    biocharStorageLocationCode: row.biocharStorageLocationCode,
    feedstockDraws: row.feedstockDraws.map(({ storageLocationId, storageLocationCode, wetMassKg }) => ({ storageLocationId, storageLocationCode, wetMassKg })),
    startTime: new Date(row.startTime).toISOString(),
    endTime: row.endTime === null ? null : new Date(row.endTime).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  });
}
