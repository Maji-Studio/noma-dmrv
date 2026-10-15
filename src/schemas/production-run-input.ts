import { z } from "zod";
import { PRODUCTION_RUN_CREATE_STATUSES, PRODUCTION_RUN_CREATE_STATUS_MESSAGE } from "@/lib/production-runs/lifecycle";
import { updateProductionRunSchema } from "./production-runs";
import { clearableNumber, pipeToCanonicalNumber, toClearableNumber, uuidSchema } from "./helpers";
import { eventInstantSchema } from "./event-instant";
import { publishedJsonSchemas } from "./published-json-schema";

/** Run alias of the shared event instant (`./event-instant`); the same schema object, so contracts stay identical. */
export const productionRunInstantSchema = eventInstantSchema;

const { productionRunId, expectedVersion, code, ...fields } = updateProductionRunSchema.shape;
const drawShape = fields.feedstockDraws.unwrap().element.shape;
publishedJsonSchemas.add(drawShape.storageLocationId, { jsonSchema: { ...z.toJSONSchema(drawShape.storageLocationId), description: "Source feedstock bin UUID in the run facility." } });
publishedJsonSchemas.add(drawShape.wetMassKg, { jsonSchema: { ...z.toJSONSchema(drawShape.wetMassKg), description: "Explicit wet mass drawn from this bin in kilograms." } });

const describedFields = {
  facilityId: fields.facilityId.describe("Owning facility identifier, UUID."),
  reactorId: fields.reactorId.describe("Reactor UUID in the effective facility."),
  status: fields.status.describe("Run state: running, complete, failed or cancelled."),
  cancellationReason: fields.cancellationReason.describe("Cancellation reason, untrusted plain text; required when cancelling."),
  operatorId: fields.operatorId.describe("Operator UUID, or null to clear."),
  feedstockDraws: fields.feedstockDraws.describe("Explicit source feedstock bin draws; each wet mass is in kilograms."),
  feedstockMoisturePercent: pipeToCanonicalNumber(clearableNumber, fields.feedstockMoisturePercent).describe("Feedstock water as percent of wet mass, 0 to below 100."),
  feedingRateKgHr: pipeToCanonicalNumber(clearableNumber, fields.feedingRateKgHr).describe("Feed rate in kilograms per hour."),
  // A direct preprocess keeps the canonical integer type in the published schema.
  residenceTimeMinutes: z.preprocess(toClearableNumber, fields.residenceTimeMinutes).describe("Residence time in minutes."),
  dieselOperationLiters: pipeToCanonicalNumber(clearableNumber, fields.dieselOperationLiters).describe("Operational diesel in litres."),
  dieselGensetLiters: pipeToCanonicalNumber(clearableNumber, fields.dieselGensetLiters).describe("Generator diesel in litres."),
  preprocessingFuelLiters: pipeToCanonicalNumber(clearableNumber, fields.preprocessingFuelLiters).describe("Preprocessing fuel in litres."),
  electricityKwh: pipeToCanonicalNumber(clearableNumber, fields.electricityKwh).describe("Electricity in kilowatt hours."),
  biocharOutputKg: pipeToCanonicalNumber(clearableNumber, fields.biocharOutputKg).describe("Wet biochar output in kilograms. Must be positive when complete."),
  biocharMoisturePercent: pipeToCanonicalNumber(clearableNumber, fields.biocharMoisturePercent).describe("Biochar water as percent of wet mass, 0 to below 100. Required when complete."),
  biocharStorageLocationId: fields.biocharStorageLocationId.describe("Biochar output bin UUID in the effective facility. Required when complete; null clears it for other statuses."),
};
export const createProductionRunInput = z.strictObject({
  ...describedFields,
  facilityId: uuidSchema().describe("Owning facility UUID."), reactorId: uuidSchema().describe("Reactor UUID in the facility."),
  status: z.enum(PRODUCTION_RUN_CREATE_STATUSES, { error: PRODUCTION_RUN_CREATE_STATUS_MESSAGE }).default("running").describe("Initial run state: running or complete."),
  startTime: productionRunInstantSchema,
  endTime: productionRunInstantSchema.nullable().optional().describe("End instant or facility-local date/time; null leaves the run open."),
});
export const updateProductionRunInput = z.strictObject({
  ...describedFields, productionRunId: productionRunId.describe("Target production run UUID."), expectedVersion: expectedVersion.describe("Version from get_production_run."), code: code.describe("Human-readable production run code."),
  startTime: productionRunInstantSchema.optional().describe("Start instant or facility-local date/time."),
  endTime: productionRunInstantSchema.nullable().optional().describe("End instant or facility-local date/time; null leaves the run open."),
});
