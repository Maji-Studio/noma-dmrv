"use server";

/**
 * Customers Server Actions
 * Server-side functions for customer and customer location CRUD operations
 */

import { createCustomer, updateCustomer, deleteCustomer, archiveCustomer, restoreCustomer } from "@/lib/operations/customers";
import { archiveCustomerLocation, restoreCustomerLocation, addCustomerLocation, updateCustomerLocation, deleteCustomerLocation } from "@/lib/operations/customer-locations";
import { runOperationInProcess } from "@/lib/operations/runner";
import { z } from "zod";
import { type Customer, type CustomerLocation } from "@/db/schema";
import {
  getCustomers as getCustomersData,
  getCustomerWithRelations as getCustomerWithRelationsData,
  getCustomerLocations as getCustomerLocationsData,
  type PaginatedCustomers,
  type CustomerDetail,
  type CreatedCustomerWithLocations,
} from "@/data-access/customers";
import {
  createCustomerWithLocationsSchema,
  updateCustomerSchema,
  customerFilterSchema,
  createCustomerLocationSchema,
  updateCustomerLocationSchema,
  deleteCustomerLocationSchema,
} from "@/schemas/customers";
import { customerLocationVersionInput } from "@/schemas/customer-location-input";
import { customerVersionInput } from "@/schemas/customer-input";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const LOG_MESSAGE = "customer action failed";

// ============================================
// Customer List/Query Operations
// ============================================

/**
 * Get paginated list of customers with filtering
 */
export async function getCustomersFn(
  filters?: Partial<z.infer<typeof customerFilterSchema>>
): Promise<ActionResult<PaginatedCustomers>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? customerFilterSchema.parse(filters)
      : undefined;
    const customers = await getCustomersData(ctx, validatedFilters);

    return customers;
  }, {
    fallbackMessage: "Failed to load customers",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: LOG_MESSAGE, context: { op: "customer:list" } },
  });
}

/**
 * Get a customer with all its relations (locations)
 */
export async function getCustomerWithRelationsFn(
  customerId: string
): Promise<ActionResult<CustomerDetail>> {
  return withAction(async (ctx) => {
    const customer = await getCustomerWithRelationsData(ctx, customerId);
    return customer;
  }, {
    fallbackMessage: "Failed to load customer details",
    log: { message: LOG_MESSAGE, context: { op: "customer:detail" } },
  });
}

/**
 * Get locations associated with a customer
 */
export async function getCustomerLocationsFn(
  customerId: string
): Promise<
  ActionResult<
    Array<{
      id: string;
      name: string;
      country: string;
      stateRegion: string | null;
      city: string | null;
      gpsLatitude: number;
      gpsLongitude: number;
      address: string | null;
      facilityDistances: import("@/schemas/facility-distances").FacilityDistance[];
      defaultSoilTemperatureC: number | null;
      isDefault: boolean;
      createdAt: Date;
      version: number;
      updatedAt: Date;
    }>
  >
> {
  return withAction(async (ctx) => {
    const locations = await getCustomerLocationsData(ctx, customerId);
    return locations;
  }, {
    fallbackMessage: "Failed to load customer locations",
    log: { message: LOG_MESSAGE, context: { op: "customer:locations" } },
  });
}

// ============================================
// Customer Create Operations
// ============================================

/** Create the customer and its locations in one transaction; any failure rolls back both. */
export async function createCustomerWithLocationsFn(
  data: z.infer<typeof createCustomerWithLocationsSchema>
): Promise<ActionResult<CreatedCustomerWithLocations>> {
  return withAction(
    async (ctx) => {
      const validated = createCustomerWithLocationsSchema.parse(data);

      const result = await runOperationInProcess(createCustomer, ctx, {
        name: validated.customer.name,
        cropType: validated.customer.cropType || null,
        address: validated.customer.address || null,
        contactEmail: validated.customer.contactEmail || null,
        contactPhone: validated.customer.contactPhone || null,
        locations: validated.locations.map(location => ({
          name: location.name,
          country: location.country,
          stateRegion: location.stateRegion || null,
          city: location.city || null,
          gpsLatitude: location.gpsLatitude,
          gpsLongitude: location.gpsLongitude,
          siteDescription: location.address || null,
          facilityDistances: location.facilityDistances,
          isDefault: location.isDefault,
          defaultSoilTemperatureC: location.defaultSoilTemperatureC,
        })),
      });
      return result;
    },
    {
      fallbackMessage:
        "The customer and its locations were not created. Try again.",
      log: {
        message: LOG_MESSAGE,
        context: { op: "customer:create-with-locations" },
      },
    },
  );
}

// ============================================
// Customer Update Operations
// ============================================

/**
 * Update an existing customer
 */
export async function updateCustomerFn(
  data: z.infer<typeof updateCustomerSchema>
): Promise<ActionResult<Customer>> {
  return withAction(async (ctx) => {

    const validated = updateCustomerSchema.parse(data);

    const customer = await runOperationInProcess(updateCustomer, ctx, {
      customerId: validated.customerId,
      expectedVersion: validated.expectedVersion,
      code: validated.code,
      name: validated.name,
      cropType: validated.cropType,
      address: validated.address,
      contactEmail: validated.contactEmail,
      contactPhone: validated.contactPhone,
    });

    return customer;
  }, { fallbackMessage: "Failed to update customer", log: { message: LOG_MESSAGE, context: { op: "customer:update" } } });
}

// ============================================
// Customer Delete Operations
// ============================================

/**
 * Delete a customer
 */
export async function deleteCustomerFn(
  data: z.infer<typeof customerVersionInput>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = customerVersionInput.parse(data);
    await runOperationInProcess(deleteCustomer, ctx, validated);

    return undefined;
  }, { fallbackMessage: "Failed to delete customer", log: { message: LOG_MESSAGE, context: { op: "customer:delete" } } });
}

// ============================================
// Customer Location Operations
// ============================================

/**
 * Create a new customer location
 */
export async function createCustomerLocationFn(
  data: z.infer<typeof createCustomerLocationSchema>
): Promise<ActionResult<CustomerLocation>> {
  return withAction(async (ctx) => {
    const validated = createCustomerLocationSchema.parse(data);

    const location = await runOperationInProcess(addCustomerLocation, ctx, {
      customerId: validated.customerId,
      name: validated.name,
      country: validated.country,
      // An empty input submits "", which must land as NULL, not a blank string.
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address || null,
      facilityDistances: validated.facilityDistances,
      defaultSoilTemperatureC: validated.defaultSoilTemperatureC,
      isDefault: validated.isDefault,
    });

    return location;
  }, {
    fallbackMessage: "Failed to create customer location",
    log: { message: LOG_MESSAGE, context: { op: "customer-location:create" } },
  });
}

/**
 * Update a customer location
 */
export async function updateCustomerLocationFn(
  data: z.infer<typeof updateCustomerLocationSchema>
): Promise<ActionResult<CustomerLocation>> {
  return withAction(async (ctx) => {

    const validated = updateCustomerLocationSchema.parse(data);

    const location = await runOperationInProcess(updateCustomerLocation, ctx, {
      locationId: validated.locationId,
      expectedVersion: validated.expectedVersion,
      name: validated.name,
      country: validated.country,
      // `undefined` leaves the column untouched (partial update); "" clears it.
      stateRegion:
        validated.stateRegion === undefined
          ? undefined
          : validated.stateRegion || null,
      city: validated.city === undefined ? undefined : validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address:
        validated.address === undefined ? undefined : validated.address || null,
      facilityDistances: validated.facilityDistances,
      defaultSoilTemperatureC: validated.defaultSoilTemperatureC,
      isDefault: validated.isDefault,
    });

    return location;
  }, { fallbackMessage: "Failed to update customer location", log: { message: LOG_MESSAGE, context: { op: "customer-location:update" } } });
}

/**
 * Delete a customer location
 */
export async function deleteCustomerLocationFn(
  data: z.infer<typeof deleteCustomerLocationSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteCustomerLocationSchema.parse(data);
    await runOperationInProcess(deleteCustomerLocation, ctx, validated);

    return undefined;
  }, { fallbackMessage: "Failed to delete customer location", log: { message: LOG_MESSAGE, context: { op: "customer-location:delete" } } });
}

export async function archiveCustomerFn(
  data: z.infer<typeof customerVersionInput>
): Promise<ActionResult<Customer>> {
  return withAction(async (ctx) => {
    const validated = customerVersionInput.parse(data);
    return runOperationInProcess(archiveCustomer, ctx, validated);
  }, { fallbackMessage: "Failed to archive customer", log: { message: LOG_MESSAGE, context: { op: "customer:archive" } } });
}

export async function restoreCustomerFn(
  data: z.infer<typeof customerVersionInput>
): Promise<ActionResult<Customer>> {
  return withAction(async (ctx) => {
    const validated = customerVersionInput.parse(data);
    return runOperationInProcess(restoreCustomer, ctx, validated);
  }, { fallbackMessage: "Failed to restore customer", log: { message: LOG_MESSAGE, context: { op: "customer:restore" } } });
}

export async function archiveCustomerLocationFn(
  data: z.infer<typeof customerLocationVersionInput>
): Promise<ActionResult<CustomerLocation & { warnings: string[] }>> {
  return withAction(async (ctx) => {
    const validated = customerLocationVersionInput.parse(data);
    return runOperationInProcess(archiveCustomerLocation, ctx, validated);
  }, { fallbackMessage: "Failed to archive customer location", log: { message: LOG_MESSAGE, context: { op: "customer-location:archive" } } });
}

export async function restoreCustomerLocationFn(
  data: z.infer<typeof customerLocationVersionInput>
): Promise<ActionResult<CustomerLocation & { warnings: string[] }>> {
  return withAction(async (ctx) => {
    const validated = customerLocationVersionInput.parse(data);
    return runOperationInProcess(restoreCustomerLocation, ctx, validated);
  }, { fallbackMessage: "Failed to restore customer location", log: { message: LOG_MESSAGE, context: { op: "customer-location:restore" } } });
}
