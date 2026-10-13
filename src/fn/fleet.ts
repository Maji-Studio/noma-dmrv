/**
 * Vehicle, driver and operator server actions: list, read, edit and delete.
 * Creation stays in `quick-add.ts`. Like their quick-add creates, these are
 * open to every member of the organization.
 */
"use server";

import {
  deleteDriver,
  getDriver,
  listDrivers,
  updateDriver,
} from "@/data-access/drivers";
import {
  deleteOperator,
  getOperator,
  listOperators,
  updateOperator,
} from "@/data-access/operators";
import {
  deleteVehicle,
  getVehicle,
  listVehicles,
  updateVehicle,
} from "@/data-access/vehicles";
import type { Driver, Operator, Vehicle } from "@/db/schema";
import { DomainError } from "@/lib/domain-errors";
import {
  deleteDriverSchema,
  deleteOperatorSchema,
  deleteVehicleSchema,
  driverIdSchema,
  operatorIdSchema,
  updateDriverSchema,
  updateOperatorSchema,
  updateVehicleSchema,
  vehicleIdSchema,
} from "@/schemas/fleet";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

function found<T>(record: T | null, message: string): T {
  if (!record) throw new DomainError("not_found", message);
  return record;
}

// ============================================
// Vehicles
// ============================================

export async function listVehiclesFn(): Promise<ActionResult<Vehicle[]>> {
  return withAction((ctx) => listVehicles(ctx), {
    fallbackMessage: "Vehicles could not be loaded. Try again.",
  });
}

export async function getVehicleFn(input: unknown): Promise<ActionResult<Vehicle>> {
  return withAction(async (ctx) => {
    const { vehicleId } = vehicleIdSchema.parse(input);
    return found(await getVehicle(ctx, vehicleId), "Vehicle not found");
  }, { fallbackMessage: "The vehicle could not be loaded. Try again." });
}

export async function updateVehicleFn(input: unknown): Promise<ActionResult<Vehicle>> {
  return withAction((ctx) => {
    const { vehicleId, expectedVersion, ...data } = updateVehicleSchema.parse(input);
    return updateVehicle(ctx, vehicleId, data, expectedVersion);
  }, { fallbackMessage: "The vehicle was not saved. Try again." });
}

export async function deleteVehicleFn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(async (ctx) => {
    const { vehicleId, expectedVersion } = deleteVehicleSchema.parse(input);
    await deleteVehicle(ctx, vehicleId, expectedVersion);
    return { id: vehicleId };
  }, { fallbackMessage: "The vehicle was not deleted. Try again." });
}

// ============================================
// Drivers
// ============================================

export async function listDriversFn(): Promise<ActionResult<Driver[]>> {
  return withAction((ctx) => listDrivers(ctx), {
    fallbackMessage: "Drivers could not be loaded. Try again.",
  });
}

export async function getDriverFn(input: unknown): Promise<ActionResult<Driver>> {
  return withAction(async (ctx) => {
    const { driverId } = driverIdSchema.parse(input);
    return found(await getDriver(ctx, driverId), "Driver not found");
  }, { fallbackMessage: "The driver could not be loaded. Try again." });
}

export async function updateDriverFn(input: unknown): Promise<ActionResult<Driver>> {
  return withAction((ctx) => {
    const { driverId, expectedVersion, ...data } = updateDriverSchema.parse(input);
    return updateDriver(ctx, driverId, data, expectedVersion);
  }, { fallbackMessage: "The driver was not saved. Try again." });
}

export async function deleteDriverFn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(async (ctx) => {
    const { driverId, expectedVersion } = deleteDriverSchema.parse(input);
    await deleteDriver(ctx, driverId, expectedVersion);
    return { id: driverId };
  }, { fallbackMessage: "The driver was not deleted. Try again." });
}

// ============================================
// Operators
// ============================================

export async function listOperatorsFn(): Promise<ActionResult<Operator[]>> {
  return withAction((ctx) => listOperators(ctx), {
    fallbackMessage: "Operators could not be loaded. Try again.",
  });
}

export async function getOperatorFn(input: unknown): Promise<ActionResult<Operator>> {
  return withAction(async (ctx) => {
    const { operatorId } = operatorIdSchema.parse(input);
    return found(await getOperator(ctx, operatorId), "Operator not found");
  }, { fallbackMessage: "The operator could not be loaded. Try again." });
}

export async function updateOperatorFn(input: unknown): Promise<ActionResult<Operator>> {
  return withAction((ctx) => {
    const { operatorId, ...data } = updateOperatorSchema.parse(input);
    return updateOperator(ctx, operatorId, data);
  }, { fallbackMessage: "The operator was not saved. Try again." });
}

export async function deleteOperatorFn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(async (ctx) => {
    const { operatorId } = deleteOperatorSchema.parse(input);
    await deleteOperator(ctx, operatorId);
    return { id: operatorId };
  }, { fallbackMessage: "The operator was not deleted. Try again." });
}
