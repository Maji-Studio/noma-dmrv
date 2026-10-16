import { z } from "zod";

export const deliveryApplicationBalanceRepresentationSchema = z.object({
  deliveryId: z.uuid().describe("Delivery identifier, UUID."),
  deliveredWetMassKg: z.number().describe("Delivered wet product kilograms, to 3 decimal places."),
  dryBiocharKg: z.number().nullable().describe("Server-derived delivered dry biochar kilograms, to 3 decimal places, or null when not recorded."),
  appliedWetMassKg: z.number().describe("Sum of applied wet product kilograms, to 3 decimal places."),
  appliedDryBiocharKg: z.number().describe("Sum of server-derived applied dry biochar kilograms, to 3 decimal places."),
  remainingWetMassKg: z.number().describe("Delivered less applied wet product kilograms, clamped at zero and rounded down to the gram. This is not a reservation."),
  earliestApplicationDate: z.iso.date().describe("Delivery calendar date, YYYY-MM-DD, on the delivery facility's clock. Earliest allowed application date."),
  site: z.object({
    customerLocationId: z.uuid().nullable().describe("Order destination customer location identifier, or null when unavailable."),
    gpsLatitude: z.number().nullable().describe("Site latitude in decimal degrees, or null when unavailable."),
    gpsLongitude: z.number().nullable().describe("Site longitude in decimal degrees, or null when unavailable."),
    defaultSoilTemperatureC: z.number().nullable().describe("Site or facility default soil temperature in degrees Celsius. Null at a 1000-year facility or without a default."),
    soilTemperatureDefault: z.literal(["customer_location", "facility", null]).describe("Origin of the temperature default. Null at a 1000-year facility or without a default."),
  }).describe("Current application defaults from the order destination and facility."),
});
