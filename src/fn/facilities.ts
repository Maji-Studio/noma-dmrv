"use server";

/**
 * Facilities Server Actions
 * Server-side functions for facility CRUD operations
 */

import { z } from "zod";
import type { Facility } from "@/db/schema";
import {
  archiveFacility,
  createFacility,
  getFacilityArchiveImpact,
  restoreFacility,
  getFacilities as getFacilitiesData,
  getFacilityById as getFacilityByIdData,
  getFacilityCountries as getFacilityCountriesData,
  updateFacility,
  type PaginatedFacilities,
  type FacilityArchiveImpact,
} from "@/data-access/facilities";
import { requireOrgContext } from "@/lib/auth/server";
import {
  archiveFacilitySchema,
  createFacilitySchema,
  restoreFacilitySchema,
  updateFacilitySchema,
  facilityFilterSchema,
} from "@/schemas/facilities";
import type { ActionResult } from "@/types/actions";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import { facilities as facilitiesTable } from "@/db/schema";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

function facilityActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "facility action failed",
    context: { op },
  });
}

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of facilities with filtering
 */
export async function getFacilitiesFn(
  filters?: Partial<z.infer<typeof facilityFilterSchema>>
): Promise<ActionResult<PaginatedFacilities>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? facilityFilterSchema.parse(filters)
      : undefined;
    const facilities = await getFacilitiesData(ctx, validatedFilters);

    return { success: true, data: facilities };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to load facilities",
        "facility:list",
      ),
    };
  }
}

/**
 * Get a single facility by ID
 */
export async function getFacilityByIdFn(
  facilityId: string
): Promise<ActionResult<Facility>> {
  try {
    const ctx = await requireOrgContext();

    const facility = await getFacilityByIdData(ctx, facilityId);
    return { success: true, data: facility };
  } catch (error) {
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to load facility",
        "facility:get",
      ),
    };
  }
}

/**
 * Get unique countries for the facility filter — active facilities by
 * default, archived when requested (the filter must match the visible list).
 */
export async function getFacilityCountriesFn(
  archived?: boolean,
): Promise<ActionResult<string[]>> {
  try {
    const ctx = await requireOrgContext();

    const countries = await getFacilityCountriesData(ctx, {
      archived: archived === true,
    });
    return { success: true, data: countries };
  } catch (error) {
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to load countries",
        "facility:countries",
      ),
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new facility
 */
export async function createFacilityFn(
  data: z.infer<typeof createFacilitySchema>
): Promise<ActionResult<Facility>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createFacilitySchema.parse(data);

    const facility = await withAutoCode(
      ctx,
      "FAC",
      facilitiesTable,
      facilitiesTable.code,
      undefined,
      (code) =>
        createFacility(ctx, {
          code,
          name: validated.name,
          country: validated.country,
          location: validated.location || null,
          address: validated.address || null,
          gpsLatitude: validated.gpsLatitude ?? null,
          gpsLongitude: validated.gpsLongitude ?? null,
          timezone: validated.timezone,
          contactEmail: validated.contactEmail || null,
          contactPhone: validated.contactPhone || null,
          durabilityOption: validated.durabilityOption,
        }),
      CODE_CONFLICT_MESSAGES.facility,
    );

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to create facility",
        "facility:create",
      ),
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing facility
 */
export async function updateFacilityFn(
  data: z.infer<typeof updateFacilitySchema>
): Promise<ActionResult<Facility>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateFacilitySchema.parse(data);

    const facility = await updateFacility(ctx, validated.facilityId, {
      code: validated.code,
      name: validated.name,
      country: validated.country,
      location: validated.location,
      address: validated.address,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      timezone: validated.timezone,
      contactEmail: validated.contactEmail,
      contactPhone: validated.contactPhone,
      durabilityOption: validated.durabilityOption,
    });

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to update facility",
        "facility:update",
      ),
    };
  }
}

// ============================================
// Archive Operations (soft delete, reversible)
// ============================================

/**
 * Preview what archiving a facility would affect (child counts + registry warning)
 */
export async function getFacilityArchiveImpactFn(
  facilityId: string
): Promise<ActionResult<FacilityArchiveImpact>> {
  try {
    const ctx = await requireOrgContext();

    const impact = await getFacilityArchiveImpact(ctx, facilityId);
    return { success: true, data: impact };
  } catch (error) {
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to load archive impact",
        "facility:archive-impact",
      ),
    };
  }
}

/**
 * Archive a facility and all attached child data (reversible)
 */
export async function archiveFacilityFn(
  data: z.infer<typeof archiveFacilitySchema>
): Promise<ActionResult<Facility>> {
  try {
    const ctx = await requireOrgContext();

    const validated = archiveFacilitySchema.parse(data);
    const facility = await archiveFacility(ctx, validated.facilityId);

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to archive facility",
        "facility:archive",
      ),
    };
  }
}

/**
 * Restore an archived facility and its archived child data
 */
export async function restoreFacilityFn(
  data: z.infer<typeof restoreFacilitySchema>
): Promise<ActionResult<Facility>> {
  try {
    const ctx = await requireOrgContext();

    const validated = restoreFacilitySchema.parse(data);
    const facility = await restoreFacility(ctx, validated.facilityId);

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: facilityActionError(
        error,
        "Failed to restore facility",
        "facility:restore",
      ),
    };
  }
}
