import { z } from "zod";
import { VEHICLE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "../etag";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const vehicleRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  identifier: z.string().nullable().describe("Vehicle registration, plate, or operational identifier, plain text, or null when unspecified."),
  vehicleType: z.string().describe("Transport vehicle classification used to select an emission factor, plain text."),
});
export type VehicleRepresentation = z.infer<typeof vehicleRepresentationSchema>;
export type VehicleRepresentationInput = LookupRepresentationInput<VehicleRepresentation>;

export function representVehicle(row: VehicleRepresentationInput): VehicleRepresentation {
  return vehicleRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}

export function vehicleEtag(row: Pick<VehicleRepresentation, "version">): string {
  return representationEtag(row.version, VEHICLE_REPRESENTATION_REVISION);
}
