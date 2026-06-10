"use server";

/**
 * Customers Server Actions
 * Server-side functions for customer and customer location CRUD operations
 */

import { z } from "zod";
import { type Customer, type CustomerLocation, customers } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
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
import { syncBiocharLegsForCustomerLocation } from "@/data-access/transport-legs";
import { getUser } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import {
  createCustomerSchema,
  deleteCustomerSchema,
  updateCustomerSchema,
  customerFilterSchema,
  createCustomerLocationSchema,
  updateCustomerLocationSchema,
  deleteCustomerLocationSchema,
} from "@/schemas/customers";
import type { ActionResult } from "@/types/actions";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? customerFilterSchema.parse(filters)
      : undefined;
    const customers = await getCustomersData(user.id, validatedFilters);

    return { success: true, data: customers };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load customers",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const customer = await getCustomerByIdData(user.id, customerId);
    return { success: true, data: customer };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load customer",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const customer = await getCustomerWithRelationsData(user.id, customerId);
    return { success: true, data: customer };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load customer details",
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
      gpsLatitude: number | null;
      gpsLongitude: number | null;
      address: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  >
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const locations = await getCustomerLocationsData(user.id, customerId);
    return { success: true, data: locations };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load customer locations",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const cropTypes = await getCustomerCropTypesData(user.id);
    return { success: true, data: cropTypes };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load crop types",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isCustomerCodeAvailableData(
      user.id,
      code,
      excludeCustomerId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check customer code",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createCustomerSchema.parse(data);

    const customer = await withAutoCode(
      "CUS",
      customers,
      customers.code,
      undefined,
      (code) =>
        createCustomer(user.id, {
          code,
          name: validated.name,
          cropType: validated.cropType || null,
          address: validated.address || null,
          contactEmail: validated.contactEmail || null,
          contactPhone: validated.contactPhone || null,
        })
    );

    return { success: true, data: customer };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create customer",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateCustomerSchema.parse(data);

    const customer = await updateCustomer(user.id, validated.customerId, {
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
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update customer",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteCustomerSchema.parse(data);
    await deleteCustomer(user.id, validated.customerId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete customer",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const location = await getCustomerLocationByIdData(user.id, locationId);
    return { success: true, data: location };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load customer location",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createCustomerLocationSchema.parse(data);

    const location = await createCustomerLocation(user.id, {
      customerId: validated.customerId,
      name: validated.name,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
      distanceFromFacilityKm: validated.distanceFromFacilityKm,
      isDefault: validated.isDefault,
    });

    return { success: true, data: location };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create customer location",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateCustomerLocationSchema.parse(data);

    const location = await updateCustomerLocation(user.id, validated.locationId, {
      name: validated.name,
      country: validated.country,
      stateRegion: validated.stateRegion || null,
      city: validated.city || null,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      address: validated.address,
      distanceFromFacilityKm: validated.distanceFromFacilityKm,
      isDefault: validated.isDefault,
    });

    // The distance feeds derived biochar distribution legs; recompute the legs
    // of every product delivered here. Best-effort — a stale leg self-heals on
    // the next delivery write and must not fail the location update.
    try {
      await syncBiocharLegsForCustomerLocation(user.id, validated.locationId);
    } catch (error) {
      logger.warn(
        {
          userId: user.id,
          customerLocationId: validated.locationId,
          err: error instanceof Error ? error.message : String(error),
        },
        "biochar transport leg resync after customer-location update failed",
      );
    }

    return { success: true, data: location };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update customer location",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteCustomerLocationSchema.parse(data);
    await deleteCustomerLocation(user.id, validated.locationId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete customer location",
    };
  }
}
