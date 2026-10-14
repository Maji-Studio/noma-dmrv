"use server";

import { withAction } from "./with-action";

import { SafeError } from "@/lib/errors";
import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { type Application, applications } from "@/db/schema/application";
import { withAutoCode } from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
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

const MAX_APPLICATION_LIST_SIZE = 100;

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
  return withAction(async (ctx) => {
    const parsedOptions = getApplicationsOptionsSchema.safeParse(options);
    if (!parsedOptions.success) {
      throw new SafeError("Applications could not be loaded. Refresh the page and try again.");
    }
    const validatedOptions = parsedOptions.data;
    if (validatedOptions?.facilityId) {
      await requireOrgFacility(ctx, validatedOptions.facilityId);
    }
    const result = await getApplicationsData(ctx, validatedOptions);
    return result;
  }, {
    fallbackMessage: "Failed to get applications",
    log: { message: "application action failed", context: { op: "application:list" } },
  });
}

export async function getApplicationDeliveryOptionsFn(
  facilityId?: string
): Promise<ActionResult<Awaited<ReturnType<typeof getApplicationDeliveryOptionsData>>>> {
  return withAction(async (ctx) => {
    const validatedFacilityId = facilityId
      ? z.string().uuid().parse(facilityId)
      : undefined;
    if (validatedFacilityId) {
      await requireOrgFacility(ctx, validatedFacilityId);
    }
    const deliveries = await getApplicationDeliveryOptionsData(ctx, validatedFacilityId);
    return deliveries;
  }, {
    fallbackMessage: "Failed to load application deliveries",
    log: { message: "application action failed", context: { op: "application:delivery-options" } },
  });
}

/**
 * Create a new application
 */
export async function createApplicationFn(
  data: z.infer<typeof createApplicationSchema>
): Promise<ActionResult<Application>> {
  return withAction(async (ctx) => {
    const validated = createApplicationSchema.parse(data);

    const application = await withAutoCode(
      ctx,
      "AP",
      applications,
      applications.code,
      undefined,
      (code) => createApplicationData(ctx, { ...validated, code })
    );

    return application;
  }, {
    fallbackMessage: "Failed to create application",
    log: { message: "application action failed", context: { op: "application:create" } },
  });
}

/**
 * Update an application
 */
export async function updateApplicationFn(
  data: z.infer<typeof updateApplicationSchema>
): Promise<ActionResult<Application>> {
  return withAction(async (ctx) => {

    const validated = updateApplicationSchema.parse(data);
    const { applicationId, ...updateData } = validated;

    // Check application exists
    const existing = await getApplicationById(ctx, applicationId);
    if (!existing) {
      throw new SafeError("Application not found");
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existing.code) {
      const codeExists = await applicationCodeExists(ctx, updateData.code, applicationId);
      if (codeExists) {
        throw new SafeError(`Application code "${updateData.code}" already exists`);
      }
    }

    const application = await updateApplicationData(ctx, applicationId, updateData);
    return application;
  }, { fallbackMessage: "Failed to update application", log: { message: "application action failed", context: { op: "application:update" } } });
}

/**
 * Delete an application
 */
export async function deleteApplicationFn(
  data: z.infer<typeof deleteApplicationSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteApplicationSchema.parse(data);

    // Check application exists
    const existing = await getApplicationById(ctx, validated.applicationId);
    if (!existing) {
      throw new SafeError("Application not found");
    }

    await deleteApplicationData(ctx, validated.applicationId, validated.expectedVersion);
    return;
  }, { fallbackMessage: "Failed to delete application", log: { message: "application action failed", context: { op: "application:delete" } } });
}
