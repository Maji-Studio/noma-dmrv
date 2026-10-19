/**
 * Server action schemas for editing and deleting vehicles, drivers and
 * operators. Each update carries the same fields as its quick-add create, so
 * the quick-add dialog can save either way.
 */

import { z } from "zod";
import { expectedVersionSchema, uuidSchema } from "./helpers";
import {
  driverQuickAddSchema,
  operatorQuickAddSchema,
  vehicleQuickAddSchema,
} from "./quick-add";

const VEHICLE_ID_MESSAGE = "Choose a valid vehicle.";
const DRIVER_ID_MESSAGE = "Choose a valid driver.";
const OPERATOR_ID_MESSAGE = "Choose a valid operator.";

/** Optional free text arrives trimmed, and a blank value clears the field. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const vehicleIdSchema = z.object({ vehicleId: uuidSchema(VEHICLE_ID_MESSAGE) });
export const driverIdSchema = z.object({ driverId: uuidSchema(DRIVER_ID_MESSAGE) });
export const operatorIdSchema = z.object({ operatorId: uuidSchema(OPERATOR_ID_MESSAGE) });

export const updateVehicleSchema = vehicleQuickAddSchema.extend({
  vehicleId: uuidSchema(VEHICLE_ID_MESSAGE),
  expectedVersion: expectedVersionSchema,
}).transform((data) => ({
  ...data,
  identifier: blankToNull(data.identifier),
  fuelType: blankToNull(data.fuelType),
}));

export const deleteVehicleSchema = vehicleIdSchema.extend({
  expectedVersion: expectedVersionSchema,
});

export const updateDriverSchema = driverQuickAddSchema.extend({
  driverId: uuidSchema(DRIVER_ID_MESSAGE),
  expectedVersion: expectedVersionSchema,
}).transform((data) => ({
  ...data,
  licenseNumber: blankToNull(data.licenseNumber),
  contactPhone: blankToNull(data.contactPhone),
}));

export const deleteDriverSchema = driverIdSchema.extend({
  expectedVersion: expectedVersionSchema,
});

export const updateOperatorSchema = operatorQuickAddSchema.extend({
  operatorId: uuidSchema(OPERATOR_ID_MESSAGE),
  expectedVersion: expectedVersionSchema,
}).transform((data) => ({
  ...data,
  credentials: blankToNull(data.credentials),
  contactPhone: blankToNull(data.contactPhone),
}));

export const deleteOperatorSchema = operatorIdSchema.extend({
  expectedVersion: expectedVersionSchema,
});

export type UpdateVehicleInput = z.input<typeof updateVehicleSchema>;
export type UpdateVehicleData = z.output<typeof updateVehicleSchema>;
export type DeleteVehicleInput = z.input<typeof deleteVehicleSchema>;
export type UpdateDriverInput = z.input<typeof updateDriverSchema>;
export type UpdateDriverData = z.output<typeof updateDriverSchema>;
export type DeleteDriverInput = z.input<typeof deleteDriverSchema>;
export type UpdateOperatorInput = z.input<typeof updateOperatorSchema>;
export type UpdateOperatorData = z.output<typeof updateOperatorSchema>;
export type DeleteOperatorInput = z.input<typeof deleteOperatorSchema>;
