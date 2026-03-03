"use server";

/**
 * Reactors Server Actions
 * Server-side functions for reactor CRUD operations
 */

import { z } from "zod";
import { type Reactor, reactors } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  createReactor,
  deleteReactor,
  getReactors as getReactorsData,
  getReactorById as getReactorByIdData,
  getReactorsByFacility as getReactorsByFacilityData,
  getReactorTypes as getReactorTypesData,
  isReactorCodeAvailable as isReactorCodeAvailableData,
  getReactorMethodBEligibility as getReactorMethodBEligibilityData,
  updateReactor,
  type PaginatedReactors,
  type ReactorWithRelations,
} from "@/data-access/reactors";
import { type MethodBEligibilitySummary } from "@/data-access/isometric";
import { getUser } from "@/lib/auth/server";
import {
  createReactorSchema,
  deleteReactorSchema,
  updateReactorSchema,
  reactorFilterSchema,
} from "@/schemas/reactors";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of reactors with filtering
 */
export async function getReactorsFn(
  filters?: Partial<z.infer<typeof reactorFilterSchema>>
): Promise<ActionResult<PaginatedReactors>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? reactorFilterSchema.parse(filters)
      : undefined;
    const reactors = await getReactorsData(user.id, validatedFilters);

    return { success: true, data: reactors };
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
        error instanceof Error ? error.message : "Failed to load reactors",
    };
  }
}

/**
 * Get a single reactor by ID
 */
export async function getReactorByIdFn(
  reactorId: string
): Promise<ActionResult<ReactorWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const reactor = await getReactorByIdData(user.id, reactorId);
    return { success: true, data: reactor };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load reactor",
    };
  }
}

/**
 * Get reactors associated with a facility
 */
export async function getReactorsByFacilityFn(
  facilityId: string
): Promise<ActionResult<Reactor[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const reactors = await getReactorsByFacilityData(user.id, facilityId);
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
 * Get unique reactor types from all reactors
 */
export async function getReactorTypesFn(): Promise<ActionResult<string[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const types = await getReactorTypesData(user.id);
    return { success: true, data: types };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load reactor types",
    };
  }
}

/**
 * Check if a reactor code is available
 */
export async function checkReactorCodeFn(
  code: string,
  excludeReactorId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isReactorCodeAvailableData(
      user.id,
      code,
      excludeReactorId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check reactor code",
    };
  }
}

/**
 * Get Method B eligibility for a specific reactor
 */
export async function getReactorMethodBEligibilityFn(
  reactorId: string
): Promise<ActionResult<MethodBEligibilitySummary>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const eligibility = await getReactorMethodBEligibilityData(user.id, reactorId);
    return { success: true, data: eligibility };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get Method B eligibility",
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new reactor
 */
export async function createReactorFn(
  data: z.infer<typeof createReactorSchema>
): Promise<ActionResult<Reactor>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createReactorSchema.parse(data);

    const reactor = await withAutoCode(
      "R",
      reactors,
      reactors.code,
      validated.code,
      (code) =>
        createReactor(user.id, {
          code,
          identifier: validated.identifier,
          facilityId: validated.facilityId,
          reactorType: validated.reactorType,
          type: validated.type,
          samplingMethod: validated.samplingMethod,
          capacityKg: validated.capacityKg ?? null,
          specifications: validated.specifications ?? null,
        })
    );

    return { success: true, data: reactor };
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
        error instanceof Error ? error.message : "Failed to create reactor",
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing reactor
 */
export async function updateReactorFn(
  data: z.infer<typeof updateReactorSchema>
): Promise<ActionResult<Reactor>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateReactorSchema.parse(data);

    const reactor = await updateReactor(user.id, validated.reactorId, {
      code: validated.code,
      identifier: validated.identifier,
      facilityId: validated.facilityId,
      reactorType: validated.reactorType,
      type: validated.type,
      samplingMethod: validated.samplingMethod,
      capacityKg: validated.capacityKg,
      specifications: validated.specifications,
    });

    return { success: true, data: reactor };
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
        error instanceof Error ? error.message : "Failed to update reactor",
    };
  }
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a reactor
 */
export async function deleteReactorFn(
  data: z.infer<typeof deleteReactorSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteReactorSchema.parse(data);
    await deleteReactor(user.id, validated.reactorId);

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
        error instanceof Error ? error.message : "Failed to delete reactor",
    };
  }
}
