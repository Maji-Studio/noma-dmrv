"use server";

import { z } from "zod";
import type { Project } from "@/db/schema";
import {
  createProject,
  deleteProject,
  getProjects as getProjectsData,
  updateProject,
} from "@/data-access/projects";
import { getUser } from "@/lib/auth/server";
import {
  createProjectSchema,
  deleteProjectSchema,
  updateProjectSchema,
} from "@/schemas/projects";
import type { ActionResult } from "@/types/actions";

export async function getProjectsFn(): Promise<ActionResult<Project[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const projects = await getProjectsData(user.id);
    return { success: true, data: projects };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load projects",
    };
  }
}

export async function createProjectFn(
  data: z.infer<typeof createProjectSchema>
): Promise<ActionResult<Project>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createProjectSchema.parse(data);
    const project = await createProject(user.id, {
      name: validated.name,
      description: validated.description || undefined,
    });

    return { success: true, data: project };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    };
  }
}

export async function updateProjectFn(
  data: z.infer<typeof updateProjectSchema>
): Promise<ActionResult<Project>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateProjectSchema.parse(data);

    const project = await updateProject(validated.projectId, user.id, {
      name: validated.name,
      description: validated.description,
    });

    return { success: true, data: project };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update project",
    };
  }
}

export async function deleteProjectFn(
  data: z.infer<typeof deleteProjectSchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteProjectSchema.parse(data);
    await deleteProject(validated.projectId, user.id);

    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete project",
    };
  }
}
