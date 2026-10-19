import { z } from "zod";
import { applicationRepresentationSchema } from "./applications";
export const applicationWriteEnvelopeSchema = z.object({
  data: applicationRepresentationSchema.describe("Application representation, provisional on a dry run."),
  allocations: z.array(z.object({
    biocharProductId: z.uuid().describe("Allocated product UUID."), productCode: z.string().describe("Allocated product code."),
    productionRunId: z.uuid().describe("Source production run UUID."), productionRunCode: z.string().describe("Source production run code."),
    wetMassKg: z.number().describe("Allocated wet product kg, to 3 decimal places."),
    dryBiocharKg: z.number().describe("Allocated server-derived dry biochar kg, to 3 decimal places."),
  })).describe("Frozen product and run shares. Capacity is rechecked under lock; committed allocations are authoritative."),
  deliveryBalance: z.object({ remainingWetMassKgBefore: z.number().describe("Remaining wet kg before the write."), remainingWetMassKgAfter: z.number().describe("Remaining wet kg after the write.") })
    .describe("Target delivery remaining wet kilograms before and after the write."),
  warnings: z.array(z.string()).optional().describe("Unchanged operation guidance about copied site defaults, mix-bin credit holds and facility reference temperature."),
});
