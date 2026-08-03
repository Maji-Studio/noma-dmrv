"use server";

/**
 * Customers Server Actions
 * Server-side functions for customer and customer location CRUD operations
 */

import { z } from "zod";
import { type Customer, type CustomerLocation, customers } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createCustomer,
  deleteCustomer,
  getCustomers as getCustomersData,
  getCustomerById as getCustomerByIdData,
  getCustomerWithRelations as getCustomerWithRelationsData,
  getCustomerLocations as getCustomerLocationsData,
  getCustomerCropTypes as getCustomerCropTypesData,
  isCustomerCodeAvailable as isCustomerCodeAvailableData,
  updateCustomer,
  createCustomerLocation,
  updateCustomerLocation,
  deleteCustomerLocation,
  getCustomerLocationById as getCustomerLocationByIdData,
  type PaginatedCustomers,
  type CustomerDetail,
} from "@/data-access/customers";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createCustomerSchema,
  deleteCustomerSchema,
  updateCustomerSchema,
  customerFilterSchema,
  createCustomerLocationSchema,
  updateCustomerLocationSchema,
  deleteCustomerLocationSchema,
} from "@/schemas/customers";
import { resolveDistanceSource } from "@/schemas/distance-source";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { ActionResult } from "@/types/actions";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

function customerActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "customer action failed",
    context: { op },
  });
}

// ============================================
// Customer List/Query Operations
// ============================================

/**
 * Get paginated list of customers with filtering
 */
export async function getCustomersFn(
  filters?: Partial<z.infer<typeof customerFilterSchema>>
): Promise<ActionResult<PaginatedCustomers>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? customerFilterSchema.parse(filters)
      : undefined;
    const customers = await getCustomersData(ctx, validatedFilters);

    return { success: true, data: customers };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to load customers",
        "customer:list",
      ),
    };
  }
}

/**
 * Get a single customer by ID
 */
export async function getCustomerByIdFn(
  customerId: string
): Promise<ActionResult<Customer>> {
  try {
    const ctx = await requireOrgContext();

    const customer = await getCustomerByIdData(ctx, customerId);
    return { success: true, data: customer };
  } catch (error) {
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to load customer",
        "customer:get",
      ),
    };
  }
}

/**
 * Get a customer with all its relations (locations)
 */
export async function getCustomerWithRelationsFn(
  customerId: string
): Promise<ActionResult<CustomerDetail>> {
  try {
    const ctx = await requireOrgContext();

    const customer = await getCustomerWithRelationsData(ctx, customerId);
    return { success: true, data: customer };
  } catch (error) {
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to load customer details",
        "customer:detail",
      ),
    };
  }
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
      name: string | null;
      country: string;
      stateRegion: string | null;
      city: string | null;
      gpsLatitude: number | null;
      gpsLongitude: number | null;
      address: string | null;
      distanceFromFacilityKm: number | null;
      distanceSource: DistanceSourceValue | null;
      defaultSoilTemperatureC: number | null;
      isDefault: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>
  >
> {
  try {
    const ctx = await requireOrgContext();

    const locations = await getCustomerLocationsData(ctx, customerId);
    return { success: true, data: locations };
  } catch (error) {
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to load customer locations",
        "customer:locations",
      ),
    };
  }
}

/**
 * Get unique crop types from all customers
 */
export async function getCustomerCropTypesFn(): Promise<
  ActionResult<string[]>
> {
  try {
    const ctx = await requireOrgContext();

    const cropTypes = await getCustomerCropTypesData(ctx);
    return { success: true, data: cropTypes };
  } catch (error) {
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to load crop types",
        "customer:crop-types",
      ),
    };
  }
}

/**
 * Check if a customer code is available
 */
export async function checkCustomerCodeFn(
  code: string,
  excludeCustomerId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const ctx = await requireOrgContext();

    const available = await isCustomerCodeAvailableData(
      ctx,
      code,
      excludeCustomerId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to check customer code",
        "customer:check-code",
      ),
    };
  }
}

// ============================================
// Customer Create Operations
// ============================================

/**
 * Create a new customer
 */
export async function createCustomerFn(
  data: z.infer<typeof createCustomerSchema>
): Promise<ActionResult<Customer>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createCustomerSchema.parse(data);

    const customer = await withAutoCode(
      ctx,
      "CUS",
      customers,
      customers.code,
      undefined,
      (code) =>
        createCustomer(ctx, {
          code,
          name: validated.name,
          cropType: validated.cropType || null,
          address: validated.address || null,
          contactEmail: validated.contactEmail || null,
          contactPhone: validated.contactPhone || null,
        }),
      CODE_CONFLICT_MESSAGES.customer,
    );

    return { success: true, data: customer };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to create customer",
        "customer:create",
      ),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = updateCustomerSchema.parse(data);

    const customer = await updateCustomer(ctx, validated.customerId, {
      code: validated.code,
      name: validated.name,
      cropType: validated.cropType,
      address: validated.address,
      contactEmail: validated.contactEmail,
      contactPhone: validated.contactPhone,
    });

    return { success: true, data: customer };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to update customer",
        "customer:update",
      ),
    };
  }
}

// ============================================
// Customer Delete Operations
// ============================================

/**
 * Delete a customer
 */
export async function deleteCustomerFn(
  data: z.infer<typeof deleteCustomerSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteCustomerSchema.parse(data);
    await deleteCustomer(ctx, validated.customerId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to delete customer",
        "customer:delete",
      ),
    };
  }
}

// ============================================
// Customer Location Operations
// ============================================

/**
 * Get a single customer location by ID
 */
export async function getCustomerLocationByIdFn(
  locationId: string
): Promise<ActionResult<CustomerLocation>> {
  try {
    const ctx = await requireOrgContext();

    const location = await getCustomerLocationByIdData(ctx, locationId);
    return { success: true, data: location };
  } catch (error) {
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to load customer location",
        "customer-location:get",
      ),
    };
  }
}

/**
 * Create a new customer location
 */
export async function createCustomerLocationFn(
  data: z.infer<typeof createCustomerLocationSchema>
): Promise<ActionResult<CustomerLocation>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createCustomerLocationSchema.parse(data);

    const location = await createCustomerLocation(ctx, {
      customerId: validated.customerId,
      name: validated.name,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
      distanceFromFacilityKm: validated.distanceFromFacilityKm,
      distanceSource: resolveDistanceSource(
        validated.distanceFromFacilityKm ?? null,
        validated.distanceSource,
      ),
      defaultSoilTemperatureC: validated.defaultSoilTemperatureC,
      isDefault: validated.isDefault,
    });

    return { success: true, data: location };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to create customer location",
        "customer-location:create",
      ),
    };
  }
}

/**
 * Update a customer location
 */
export async function updateCustomerLocationFn(
  data: z.infer<typeof updateCustomerLocationSchema>
): Promise<ActionResult<CustomerLocation>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateCustomerLocationSchema.parse(data);

    const location = await updateCustomerLocation(ctx, validated.locationId, {
      name: validated.name,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
      distanceFromFacilityKm: validated.distanceFromFacilityKm,
      distanceSource: resolveDistanceSource(
        validated.distanceFromFacilityKm,
        validated.distanceSource,
      ),
      defaultSoilTemperatureC: validated.defaultSoilTemperatureC,
      isDefault: validated.isDefault,
    });

    return { success: true, data: location };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to update customer location",
        "customer-location:update",
      ),
    };
  }
}

/**
 * Delete a customer location
 */
export async function deleteCustomerLocationFn(
  data: z.infer<typeof deleteCustomerLocationSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteCustomerLocationSchema.parse(data);
    await deleteCustomerLocation(ctx, validated.locationId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: customerActionError(
        error,
        "Failed to delete customer location",
        "customer-location:delete",
      ),
    };
  }
}
