/**
 * Project data access
 * Database queries for projects
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, type Project } from "@/db/schema";

/**
 * Get all projects for current user
 */
export async function getProjects(userId: string): Promise<Project[]> {
  if (!userId) {
    throw new Error("Unauthorized");
  }

  return db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, userId)
      )
    )
    .orderBy(desc(projects.updatedAt));
}

/**
 * Get project by ID
 * Throws if project not found or user is not a member
 */
export async function getProjectById(
  id: string,
  userId: string
): Promise<Project> {
  await requireProjectMember(id, userId);

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
}

/**
 * Create new project
 * Also creates owner membership for the creator
 */
export async function createProject(
  userId: string,
  data: {
    name: string;
    description?: string;
  }
): Promise<Project> {
  if (!userId) {
    throw new Error("Unauthorized");
  }

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        ownerId: userId,
        name: data.name,
        description: data.description,
      })
      .returning();

    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: "owner",
    });

    return project;
  });
}

/**
 * Update project
 * Only project owner can update
 */
export async function updateProject(
  id: string,
  userId: string,
  data: { name?: string; description?: string }
): Promise<Project> {
  const isOwner = await isProjectOwner(id, userId);
  if (!isOwner) {
    throw new Error("Forbidden: Only project owners can update projects");
  }

  const [updatedProject] = await db
    .update(projects)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();

  if (!updatedProject) {
    throw new Error("Project not found");
  }

  return updatedProject;
}

/**
 * Delete project
 * Only project owner can delete
 */
export async function deleteProject(id: string, userId: string): Promise<void> {
  const isOwner = await isProjectOwner(id, userId);
  if (!isOwner) {
    throw new Error("Forbidden: Only project owners can delete projects");
  }

  await db.delete(projects).where(eq(projects.id, id));
}

/**
 * Require user to be a project member
 * Throws error if user is not a member
 */
export async function requireProjectMember(
  projectId: string,
  userId: string
): Promise<void> {
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId)
    ),
  });

  if (!membership) {
    throw new Error("Forbidden: Not a project member");
  }
}

/**
 * Check if user is project owner
 */
export async function isProjectOwner(
  projectId: string,
  userId: string
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
      eq(projectMembers.role, "owner")
    ),
  });

  return !!membership;
}

/**
 * Get user's role in project
 */
export async function getProjectRole(
  projectId: string,
  userId: string
): Promise<string | null> {
  if (!userId) {
    return null;
  }

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId)
    ),
  });

  return membership?.role ?? null;
}
