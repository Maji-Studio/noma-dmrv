import { ALLOCATION_POLICIES } from "@/lib/output-stock/planner";
import { z } from "zod";
import { deliveryRepresentationSchema } from "./deliveries";
import { itemEnvelopeSchema, stockBasisWriteEnvelopeSchema } from "./envelopes";

export const deliveryAllocationSchema = z.object({
  layerId: z.uuid().describe("Drawn product layer identifier, from the bin stock read."),
  code: z.string().describe("Drawn product code."),
  dryBiocharKg: z.number().describe("Dry biochar kilograms drawn from this product, at 3 decimal places from the stored allocation."),
  solidsKg: z.number().describe("Total solids kilograms drawn, including ingredient solids, from the exact rational truncated to 12 decimal places."),
  wetKg: z.number().nullable().describe("Wet kilograms drawn at the supplied moisture reading, at 3 decimal places from the stored allocation."),
  moisturePercent: z.number().nullable().describe("Measured water as percent of wet mass for this draw, at up to 6 decimal places from the supplied reading."),
  policy: z.enum(ALLOCATION_POLICIES).describe("Draw policy: oldest first, newest first, mixed proportions, or the supplied source order."),
});
export type DeliveryAllocation = z.infer<typeof deliveryAllocationSchema>;

/** Allocations ship on both committed creates and dry runs, in draw order. */
export const deliveryCreateEnvelopeSchema = stockBasisWriteEnvelopeSchema(deliveryRepresentationSchema).extend({
  warnings: z.array(z.string()).describe("Non-blocking guidance to upload the bill of lading as a delivery document of type bill_of_lading."),
  allocations: z.array(deliveryAllocationSchema).describe("Products drawn, in draw order, on committed creates and dry runs. Allocation sums can differ from the delivery's 3 decimal place dryBiocharKg in trailing digits."),
});
export const deliveryUpdateEnvelopeSchema = itemEnvelopeSchema(deliveryRepresentationSchema);
