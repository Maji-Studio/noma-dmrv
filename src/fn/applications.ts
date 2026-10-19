"use server";

import { withAction } from "./with-action";

import { SafeError } from "@/lib/errors";
import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { type Application } from "@/db/schema/application";
import { runOperationInProcess } from "@/lib/operations/runner";
import { recordApplication, updateApplication, deleteApplication } from "@/lib/operations/applications";
import { recordApplicationInput, updateApplicationInput, deleteApplicationInput } from "@/schemas/application-input";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getApplications as getApplicationsData,
  getApplicationDeliveryOptions as getApplicationDeliveryOptionsData,
  type ApplicationListItem,
  type ApplicationListOptions,
} from "@/data-access/applications";
import {
  applicationEvidenceMethods,
  applicationStatuses,
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

export async function createApplicationFn(data: z.input<typeof recordApplicationInput>): Promise<ActionResult<Application>> {
  return withAction(async ctx => (await runOperationInProcess(recordApplication, ctx, recordApplicationInput.parse(data))).application, {
    fallbackMessage: "Failed to create application", log: { message: "application action failed", context: { op: "application:create" } },
  });
}
export async function updateApplicationFn(data: z.input<typeof updateApplicationInput>): Promise<ActionResult<Application>> {
  return withAction(async ctx => (await runOperationInProcess(updateApplication, ctx, updateApplicationInput.parse(data))).application, {
    fallbackMessage: "Failed to update application", log: { message: "application action failed", context: { op: "application:update" } },
  });
}
export async function deleteApplicationFn(data: z.input<typeof deleteApplicationInput>): Promise<ActionResult<void>> {
  return withAction(ctx => runOperationInProcess(deleteApplication, ctx, deleteApplicationInput.parse(data)), {
    fallbackMessage: "Failed to delete application", log: { message: "application action failed", context: { op: "application:delete" } },
  });
}
