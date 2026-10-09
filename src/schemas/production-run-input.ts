import { z } from "zod";
import { updateProductionRunSchema } from "./production-runs";
import { clearableNumber, pipeToCanonicalNumber, toClearableNumber } from "./helpers";
import { publishedJsonSchemas } from "./published-json-schema";

const offsetInstant = z.iso.datetime({ offset: true, message: "Add an explicit offset (Z or +hh:mm), or send { date, time }." });
const localInstant = z.strictObject({ date: z.iso.date().describe("Calendar date in the effective facility time zone, YYYY-MM-DD."), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("Facility-local wall time, HH:MM. DST gaps and ambiguous repeated times are refused.") });
const wireInstant = z.union([offsetInstant, localInstant]).describe("An RFC 3339 instant with explicit offset, or a date/time in the effective facility zone.");
/** Native Dates are accepted for validated server actions only. */
export const productionRunInstantSchema = z.union([z.date(), offsetInstant, localInstant], { error: "Add an explicit offset (Z or +hh:mm), or send { date, time }." })
  .register(publishedJsonSchemas, { jsonSchema: z.toJSONSchema(wireInstant) });

const { productionRunId, expectedVersion, code, feedstockWetMassKg, feedstockStorageLocationId, ...fields } = updateProductionRunSchema.shape;
void feedstockWetMassKg;
void feedstockStorageLocationId;
const drawShape = fields.feedstockDraws.unwrap().element.shape;
publishedJsonSchemas.add(drawShape.storageLocationId, { jsonSchema: { ...z.toJSONSchema(drawShape.storageLocationId), description: "Source feedstock bin UUID in the run facility." } });
publishedJsonSchemas.add(drawShape.wetMassKg, { jsonSchema: { ...z.toJSONSchema(drawShape.wetMassKg), description: "Explicit wet mass drawn from this bin in kilograms." } });

const describedFields = {
  facilityId: fields.facilityId.describe("Owning facility identifier, UUID."),
  reactorId: fields.reactorId.describe("Reactor UUID in the effective facility."),
  status: fields.status.describe("Run state: draft, running, complete, failed or cancelled."),
  cancellationReason: fields.cancellationReason.describe("Cancellation reason, untrusted plain text; required when cancelling."),
  operatorId: fields.operatorId.describe("Operator UUID, or null to clear."),
  feedstockDraws: fields.feedstockDraws.describe("Explicit source feedstock bin draws; each wet mass is in kilograms."),
  feedstockMoisturePercent: pipeToCanonicalNumber(clearableNumber, fields.feedstockMoisturePercent).describe("Feedstock water as percent of wet mass, 0 to 100."),
  feedingRateKgHr: pipeToCanonicalNumber(clearableNumber, fields.feedingRateKgHr).describe("Feed rate in kilograms per hour."),
  // A direct preprocess keeps the canonical integer type in the published schema.
  residenceTimeMinutes: z.preprocess(toClearableNumber, fields.residenceTimeMinutes).describe("Residence time in minutes."),
  dieselOperationLiters: pipeToCanonicalNumber(clearableNumber, fields.dieselOperationLiters).describe("Operational diesel in litres."),
  dieselGensetLiters: pipeToCanonicalNumber(clearableNumber, fields.dieselGensetLiters).describe("Generator diesel in litres."),
  preprocessingFuelLiters: pipeToCanonicalNumber(clearableNumber, fields.preprocessingFuelLiters).describe("Preprocessing fuel in litres."),
  electricityKwh: pipeToCanonicalNumber(clearableNumber, fields.electricityKwh).describe("Electricity in kilowatt hours."),
  biocharOutputKg: pipeToCanonicalNumber(clearableNumber, fields.biocharOutputKg).describe("Wet biochar output in kilograms."),
  biocharMoisturePercent: pipeToCanonicalNumber(clearableNumber, fields.biocharMoisturePercent).describe("Biochar water as percent of wet mass, 0 to 100."),
  biocharStorageLocationId: fields.biocharStorageLocationId.describe("Output bin UUID in the effective facility, or null to clear."),
};
export const createProductionRunInput = z.strictObject({
  ...describedFields,
  facilityId: z.uuid().describe("Owning facility UUID."), reactorId: z.uuid().describe("Reactor UUID in the facility."),
  status: fields.status.unwrap().default("draft").describe("Initial run state: draft, running, complete or cancelled."),
  startTime: productionRunInstantSchema,
  endTime: productionRunInstantSchema.nullable().optional().describe("End instant or facility-local date/time; null leaves the run open."),
});
export const updateProductionRunInput = z.strictObject({
  ...describedFields, productionRunId: productionRunId.describe("Target production run UUID."), expectedVersion: expectedVersion.describe("Version from get_production_run."), code: code.describe("Human-readable production run code."),
  startTime: productionRunInstantSchema.optional().describe("Start instant or facility-local date/time."),
  endTime: productionRunInstantSchema.nullable().optional().describe("End instant or facility-local date/time; null leaves the run open."),
});
