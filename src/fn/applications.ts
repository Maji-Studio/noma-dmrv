"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { type Application, applications } from "@/db/schema/application";
import { withAutoCode } from "@/data-access/code-generator";
import { getUser } from "@/lib/auth/server";
import {
  getApplications as getApplicationsData,
  getApplicationById,
  createApplication as createApplicationData,
  updateApplication as updateApplicationData,
  deleteApplication as deleteApplicationData,
  applicationCodeExists,
} from "@/data-access/applications";
import {
  createApplicationSchema,
  updateApplicationSchema,
  deleteApplicationSchema,
} from "@/schemas/applications";

/**
 * Get applications with pagination
 */
export async function getApplicationsFn(
  options?: { page?: number; pageSize?: number }
): Promise<ActionResult<{ items: Application[]; total: number; page: number; pageSize: number; totalPages: number }>> {
  try {
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const result = await getApplicationsData(user.id, options);
    return { success: true, data: result };
  } catch (error) {
    console.error("Failed to get applications:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get applications",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const application = await getApplicationById(user.id, id);
    if (!application) {
      return { success: false, error: "Application not found" };
    }

    return { success: true, data: application };
  } catch (error) {
    console.error("Failed to get application:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get application",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createApplicationSchema.parse(data);

    const application = await withAutoCode(
      "AP",
      applications,
      applications.code,
      validated.code,
      (code) => createApplicationData(user.id, { ...validated, code })
    );

    return { success: true, data: application };
  } catch (error) {
    console.error("Failed to create application:", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create application",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateApplicationSchema.parse(data);
    const { applicationId, ...updateData } = validated;

    // Check application exists
    const existing = await getApplicationById(user.id, applicationId);
    if (!existing) {
      return { success: false, error: "Application not found" };
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existing.code) {
      const codeExists = await applicationCodeExists(user.id, updateData.code, applicationId);
      if (codeExists) {
        return {
          success: false,
          error: `Application code "${updateData.code}" already exists`,
        };
      }
    }

    const application = await updateApplicationData(user.id, applicationId, updateData);
    return { success: true, data: application };
  } catch (error) {
    console.error("Failed to update application:", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update application",
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
    const user = await getUser();
    if (!user || !user.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteApplicationSchema.parse(data);

    // Check application exists
    const existing = await getApplicationById(user.id, validated.applicationId);
    if (!existing) {
      return { success: false, error: "Application not found" };
    }

    await deleteApplicationData(user.id, validated.applicationId);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Failed to delete application:", error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((e) => e.message).join(", "),
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete application",
    };
  }
}
