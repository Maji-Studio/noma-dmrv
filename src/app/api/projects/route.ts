/**
 * Projects API routes
 * Handles project CRUD operations
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjects, createProject } from "@/data-access/projects";
import { getUser } from "@/lib/auth/server";
import { createProjectSchema } from "@/schemas/projects";

export async function GET() {
  try {
    const user = await getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projects = await getProjects(user.id);
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load projects" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON");
    });
    const validated = createProjectSchema.parse(body);

    const project = await createProject(user.id, {
      name: validated.name,
      description: validated.description || undefined,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create project" },
      { status: 500 }
    );
  }
}
