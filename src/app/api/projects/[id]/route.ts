/**
 * Single project API routes
 * Handles individual project operations
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteProject,
  getProjectById,
  updateProject,
} from "@/data-access/projects";
import { getUser } from "@/lib/auth/server";
import { updateProjectSchema } from "@/schemas/projects";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    void request;
    const user = await getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = paramsSchema.parse(await params);
    const project = await getProjectById(id, user.id);

    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid project ID", issues: error.issues },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to load project";
    const lowered = message.toLowerCase();
    const status = lowered.includes("forbidden") || lowered.includes("unauthorized")
      ? 403
      : lowered.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = paramsSchema.parse(await params);
    const body = await request.json().catch(() => {
      throw new SyntaxError("Invalid JSON");
    });
    const validated = updateProjectSchema.parse({ ...body, projectId: id });

    const project = await updateProject(id, user.id, {
      name: validated.name,
      description: validated.description,
    });

    return NextResponse.json({ project });
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

    const message =
      error instanceof Error ? error.message : "Failed to update project";
    const lowered = message.toLowerCase();
    const status = lowered.includes("forbidden") || lowered.includes("unauthorized")
      ? 403
      : lowered.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    void request;
    const user = await getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = paramsSchema.parse(await params);
    await deleteProject(id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid project ID", issues: error.issues },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to delete project";
    const lowered = message.toLowerCase();
    const status = lowered.includes("forbidden") || lowered.includes("unauthorized")
      ? 403
      : lowered.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
