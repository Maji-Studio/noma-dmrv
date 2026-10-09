import { z } from "zod";
import { updateProductionRunSchema } from "./production-runs";
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
export const createProductionRunInput = z.strictObject({
  ...fields,
  facilityId: z.uuid(), reactorId: z.uuid(),
  status: fields.status.unwrap().default("draft"),
  startTime: productionRunInstantSchema,
  endTime: productionRunInstantSchema.nullable().optional(),
});
export const updateProductionRunInput = z.strictObject({
  ...fields, productionRunId, expectedVersion, code,
  startTime: productionRunInstantSchema.optional(),
  endTime: productionRunInstantSchema.nullable().optional(),
});
