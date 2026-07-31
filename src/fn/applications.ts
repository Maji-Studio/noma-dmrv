"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { type Application, applications } from "@/db/schema/application";
import { withAutoCode } from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgContext } from "@/lib/auth/server";
import {
  getApplications as getApplicationsData,
  getApplicationById,
  getApplicationDeliveryOptions as getApplicationDeliveryOptionsData,
  createApplication as createApplicationData,
  updateApplication as updateApplicationData,
  deleteApplication as deleteApplicationData,
  applicationCodeExists,
  type ApplicationListItem,
  type ApplicationListOptions,
} from "@/data-access/applications";
import {
  applicationEvidenceMethods,
  applicationStatuses,
  createApplicationSchema,
  updateApplicationSchema,
  deleteApplicationSchema,
} from "@/schemas/applications";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

const MAX_APPLICATION_LIST_SIZE = 100;

function applicationActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "application action failed",
    context: { op },
  });
}

const getApplicationsOptionsSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(MAX_APPLICATION_LIST_SIZE).optional(),
  facilityId: z.string().uuid().optional(),
  creditBatchId: z.string().uuid().optional(),
  ids: z.array(z.uuid()).max(MAX_APPLICATION_LIST_SIZE).optional(),
  search: z.string().max(255).optional(),
  status: z.enum(applicationStatuses).optional(),
  evidenceMethod: z.enum(applicationEvidenceMethods).optional(),
}).optional();

/**
 * Get applications with pagination
 */
export async function getApplicationsFn(
  options?: ApplicationListOptions,
): Promise<ActionResult<{ items: ApplicationListItem[]; total: number; page: number; pageSize: number; totalPages: number }>> {
  try {
    const ctx = await requireOrgContext();

    const validatedOptions = getApplicationsOptionsSchema.parse(options);
    if (validatedOptions?.facilityId) {
      await requireOrgFacility(ctx, validatedOptions.facilityId);
    }
    const result = await getApplicationsData(ctx, validatedOptions);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: applicationActionError(
        error,
        "Failed to get applications",
        "application:list",
      ),
    };
  }
}

export async function getApplicationDeliveryOptionsFn(
  facilityId?: string
): Promise<ActionResult<Awaited<ReturnType<typeof getApplicationDeliveryOptionsData>>>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFacilityId = facilityId
      ? z.string().uuid().parse(facilityId)
      : undefined;
    if (validatedFacilityId) {
      await requireOrgFacility(ctx, validatedFacilityId);
    }
    const deliveries = await getApplicationDeliveryOptionsData(ctx, validatedFacilityId);
    return { success: true, data: deliveries };
  } catch (error) {
    return {
      success: false,
      error: applicationActionError(
        error,
        "Failed to load application deliveries",
        "application:delivery-options",
      ),
    };
  }
}

/**
 * Get application by ID
 */
export async function getApplicationByIdFn(
  id: string
): Promise<ActionResult<Application>> {
  try {
    const ctx = await requireOrgContext();

    const application = await getApplicationById(ctx, id);
    if (!application) {
      return { success: false, error: "Application not found" };
    }

    return { success: true, data: application };
  } catch (error) {
    return {
      success: false,
      error: applicationActionError(
        error,
        "Failed to get application",
        "application:get",
      ),
    };
  }
}

/**
 * Create a new application
 */
export async function createApplicationFn(
  data: z.infer<typeof createApplicationSchema>
): Promise<ActionResult<Application>> {
  try {
    const ctx = await requireOrgContext();

    const validated = createApplicationSchema.parse(data);

    const application = await withAutoCode(
      ctx,
      "AP",
      applications,
      applications.code,
      undefined,
      (code) => createApplicationData(ctx, { ...validated, code })
    );

    return { success: true, data: application };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: applicationActionError(
        error,
        "Failed to create application",
        "application:create",
      ),
    };
  }
}

/**
 * Update an application
 */
export async function updateApplicationFn(
  data: z.infer<typeof updateApplicationSchema>
): Promise<ActionResult<Application>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateApplicationSchema.parse(data);
    const { applicationId, ...updateData } = validated;

    // Check application exists
    const existing = await getApplicationById(ctx, applicationId);
    if (!existing) {
      return { success: false, error: "Application not found" };
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existing.code) {
      const codeExists = await applicationCodeExists(ctx, updateData.code, applicationId);
      if (codeExists) {
        return {
          success: false,
          error: `Application code "${updateData.code}" already exists`,
        };
      }
    }

    const application = await updateApplicationData(ctx, applicationId, updateData);
    return { success: true, data: application };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: applicationActionError(
        error,
        "Failed to update application",
        "application:update",
      ),
    };
  }
}

/**
 * Delete an application
 */
export async function deleteApplicationFn(
  data: z.infer<typeof deleteApplicationSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteApplicationSchema.parse(data);

    // Check application exists
    const existing = await getApplicationById(ctx, validated.applicationId);
    if (!existing) {
      return { success: false, error: "Application not found" };
    }

    await deleteApplicationData(ctx, validated.applicationId);
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
      error: applicationActionError(
        error,
        "Failed to delete application",
        "application:delete",
      ),
    };
  }
}
