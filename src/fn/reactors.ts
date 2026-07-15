"use server";

/**
 * Reactors Server Actions
 * Server-side functions for reactor CRUD operations
 */

import { z } from "zod";
import { type Reactor, reactors } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createReactor,
  deleteReactor,
  getReactors as getReactorsData,
  getReactorById as getReactorByIdData,
  getReactorsByFacility as getReactorsByFacilityData,
  getReactorTypes as getReactorTypesData,
  isReactorCodeAvailable as isReactorCodeAvailableData,
  updateReactor,
  type PaginatedReactors,
  type ReactorWithRelations,
} from "@/data-access/reactors";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createReactorSchema,
  deleteReactorSchema,
  updateReactorSchema,
  reactorFilterSchema,
} from "@/schemas/reactors";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

function reactorActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "reactor action failed",
    context: { op },
  });
}

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
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? reactorFilterSchema.parse(filters)
      : undefined;
    const reactors = await getReactorsData(ctx, validatedFilters);

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
      error: reactorActionError(
        error,
        "Failed to load reactors",
        "reactor:list",
      ),
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
    const ctx = await requireOrgContext();

    const reactor = await getReactorByIdData(ctx, reactorId);
    return { success: true, data: reactor };
  } catch (error) {
    return {
      success: false,
      error: reactorActionError(
        error,
        "Failed to load reactor",
        "reactor:get",
      ),
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
    const ctx = await requireOrgContext();

    const reactors = await getReactorsByFacilityData(ctx, facilityId);
    return { success: true, data: reactors };
  } catch (error) {
    return {
      success: false,
      error: reactorActionError(
        error,
        "Failed to load facility reactors",
        "reactor:by-facility",
      ),
    };
  }
}

/**
 * Get unique reactor types from all reactors
 */
export async function getReactorTypesFn(): Promise<ActionResult<string[]>> {
  try {
    const ctx = await requireOrgContext();

    const types = await getReactorTypesData(ctx);
    return { success: true, data: types };
  } catch (error) {
    return {
      success: false,
      error: reactorActionError(
        error,
        "Failed to load reactor types",
        "reactor:types",
      ),
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
    const ctx = await requireOrgContext();

    const available = await isReactorCodeAvailableData(
      ctx,
      code,
      excludeReactorId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: reactorActionError(
        error,
        "Failed to check reactor code",
        "reactor:check-code",
      ),
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
    const ctx = await requireOrgContext();

    const validated = createReactorSchema.parse(data);

    const reactor = await withAutoCode(
      ctx,
      "R",
      reactors,
      reactors.code,
      undefined,
      (code) =>
        createReactor(ctx, {
          code,
          identifier: validated.identifier,
          facilityId: validated.facilityId,
          reactorType: validated.reactorType,
          nominalThroughputTph: validated.nominalThroughputTph ?? null,
          specifications: validated.specifications ?? null,
        }),
      CODE_CONFLICT_MESSAGES.reactor,
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
      error: reactorActionError(
        error,
        "Failed to create reactor",
        "reactor:create",
      ),
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
    const ctx = await requireOrgContext();

    const validated = updateReactorSchema.parse(data);

    const reactor = await updateReactor(ctx, validated.reactorId, {
      code: validated.code,
      identifier: validated.identifier,
      facilityId: validated.facilityId,
      reactorType: validated.reactorType,
      nominalThroughputTph: validated.nominalThroughputTph,
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
      error: reactorActionError(
        error,
        "Failed to update reactor",
        "reactor:update",
      ),
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
    const ctx = await requireOrgContext();

    const validated = deleteReactorSchema.parse(data);
    await deleteReactor(ctx, validated.reactorId);

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
      error: reactorActionError(
        error,
        "Failed to delete reactor",
        "reactor:delete",
      ),
    };
  }
}
