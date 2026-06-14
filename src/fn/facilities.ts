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
  getFacilityWithRelations as getFacilityWithRelationsData,
  getFacilityReactors as getFacilityReactorsData,
  getFacilityStorageLocations as getFacilityStorageLocationsData,
  getFacilityCountries as getFacilityCountriesData,
  isFacilityCodeAvailable as isFacilityCodeAvailableData,
  updateFacility,
  type PaginatedFacilities,
  type FacilityDetail,
  type FacilityArchiveImpact,
} from "@/data-access/facilities";
import { getUser } from "@/lib/auth/server";
import {
  archiveFacilitySchema,
  createFacilitySchema,
  restoreFacilitySchema,
  updateFacilitySchema,
  facilityFilterSchema,
} from "@/schemas/facilities";
import type { ActionResult } from "@/types/actions";
import { withAutoCode } from "@/data-access/code-generator";
import { facilities as facilitiesTable } from "@/db/schema";
import { toLoggedActionError } from "./action-errors";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? facilityFilterSchema.parse(filters)
      : undefined;
    const facilities = await getFacilitiesData(user.id, validatedFilters);

    return { success: true, data: facilities };
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
        error instanceof Error ? error.message : "Failed to load facilities",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const facility = await getFacilityByIdData(user.id, facilityId);
    return { success: true, data: facility };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load facility",
    };
  }
}

/**
 * Get a facility with all its relations (reactors, storage locations)
 */
export async function getFacilityWithRelationsFn(
  facilityId: string
): Promise<ActionResult<FacilityDetail>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const facility = await getFacilityWithRelationsData(user.id, facilityId);
    return { success: true, data: facility };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load facility details",
    };
  }
}

/**
 * Get reactors associated with a facility
 */
export async function getFacilityReactorsFn(
  facilityId: string
): Promise<
  ActionResult<
    Array<{
      id: string;
      code: string;
      identifier: string;
      reactorType: string;
      nominalThroughputTph: number | null;
      samplingMethod: string;
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

    const reactors = await getFacilityReactorsData(user.id, facilityId);
    return { success: true, data: reactors };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load facility reactors",
    };
  }
}

/**
 * Get storage locations associated with a facility
 */
export async function getFacilityStorageLocationsFn(
  facilityId: string
): Promise<
  ActionResult<
    Array<{
      id: string;
      code: string;
      name: string;
      type: string;
      capacityKg: number | null;
      storageMethod: string | null;
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

    const storageLocations = await getFacilityStorageLocationsData(
      user.id,
      facilityId
    );
    return { success: true, data: storageLocations };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load facility storage locations",
    };
  }
}

/**
 * Get unique countries from all facilities
 */
export async function getFacilityCountriesFn(): Promise<
  ActionResult<string[]>
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const countries = await getFacilityCountriesData(user.id);
    return { success: true, data: countries };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load countries",
    };
  }
}

/**
 * Check if a facility code is available
 */
export async function checkFacilityCodeFn(
  code: string,
  excludeFacilityId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isFacilityCodeAvailableData(
      user.id,
      code,
      excludeFacilityId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check facility code",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createFacilitySchema.parse(data);

    const facility = await withAutoCode(
      "FAC",
      facilitiesTable,
      facilitiesTable.code,
      undefined,
      (code) =>
        createFacility(user.id, {
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
          defaultDurabilityOption: validated.defaultDurabilityOption,
        })
    );

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateFacilitySchema.parse(data);

    const facility = await updateFacility(user.id, validated.facilityId, {
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
      defaultDurabilityOption: validated.defaultDurabilityOption,
    });

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const impact = await getFacilityArchiveImpact(user.id, facilityId);
    return { success: true, data: impact };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load archive impact",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = archiveFacilitySchema.parse(data);
    const facility = await archiveFacility(user.id, validated.facilityId);

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = restoreFacilitySchema.parse(data);
    const facility = await restoreFacility(user.id, validated.facilityId);

    return { success: true, data: facility };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
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
