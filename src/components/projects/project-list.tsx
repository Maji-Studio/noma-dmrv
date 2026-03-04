"use client";

import Link from "next/link";
import { useState } from "react";
import type { Project } from "@/db/schema";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from "@/hooks/use-projects";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ProjectForm } from "./project-form";

export function ProjectList() {
  const [isCreating, setIsCreating] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const toast = useToast();

  const handleCreate = async (data: { name: string; description?: string }) => {
    setCreateError(null);
    try {
      await createProject.mutateAsync(data);
      setIsCreating(false);
      toast.success("Project created successfully");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create project"
      );
    }
  };

  const handleUpdate = async (data: { name: string; description?: string }) => {
    if (!editingProject) return;

    setUpdateError(null);
    try {
      await updateProject.mutateAsync({
        projectId: editingProject.id,
        ...data,
      });
      setEditingProject(null);
      toast.success("Project updated successfully");
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to update project"
      );
    }
  };

  const handleDelete = (projectId: string) => {
    setDeletingProjectId(projectId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProjectId) return;
    setDeleteError(null);
    try {
      await deleteProject.mutateAsync(deletingProjectId);
      setDeletingProjectId(null);
      toast.success("Project deleted successfully");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete project"
      );
    }
  };

  if (isLoading) {
    return <div className="body-large">Loading projects...</div>;
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Projects</h1>
        {!isCreating && !editingProject ? (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="h-[48px] px-16 bg-[var(--clr-dark-purple)] text-white rounded-none hover:opacity-90 transition-opacity"
          >
            New Project
          </button>
        ) : null}
      </div>

      {isCreating ? (
        <div className="p-32 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] bg-[var(--color-background-white)]">
          <h2 className="title-heading-3 mb-24">Create Project</h2>
          {createError ? <ServerError message={createError} /> : null}
          <ProjectForm
            onSubmit={handleCreate}
            onCancel={() => {
              setIsCreating(false);
              setCreateError(null);
            }}
            isSubmitting={createProject.isPending}
            submitLabel="Create Project"
          />
        </div>
      ) : null}

      {editingProject ? (
        <div className="p-32 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] bg-[var(--color-background-white)]">
          <h2 className="title-heading-3 mb-24">Edit Project</h2>
          {updateError ? <ServerError message={updateError} /> : null}
          <ProjectForm
            defaultValues={{
              name: editingProject.name,
              description: editingProject.description ?? "",
            }}
            onSubmit={handleUpdate}
            onCancel={() => {
              setEditingProject(null);
              setUpdateError(null);
            }}
            isSubmitting={updateProject.isPending}
            submitLabel="Save Changes"
          />
        </div>
      ) : null}

      {!projects || projects.length === 0 ? (
        <div className="p-48 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] rounded-[var(--radius-8)] flex flex-col items-center justify-center gap-24 text-center">
          <div className="flex flex-col gap-16">
            <h2 className="title-heading-3">No projects yet</h2>
            <p className="body-large text-[var(--color-text-secondary)]">
              Create your first project to get started.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-24">
          {projects.map((project) => (
            <div
              key={project.id}
              className="p-32 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] bg-[var(--color-background-white)]"
            >
              <div className="flex items-start justify-between gap-24">
                <div className="flex flex-col gap-16 min-w-0">
                  <Link
                    href={`/${project.id}/dashboard`}
                    className="title-heading-3 hover:underline"
                  >
                    {project.name}
                  </Link>
                  {project.description ? (
                    <p className="body-medium text-[var(--color-text-secondary)]">
                      {project.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-16">
                  <button
                    type="button"
                    onClick={() => setEditingProject(project)}
                    className="h-[48px] px-16 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(project.id)}
                    className="h-[48px] px-16 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteError ? <ServerError message={deleteError} /> : null}

      <DeleteConfirmDialog
        isOpen={!!deletingProjectId}
        title="Delete Project"
        message="Are you sure you want to delete this project? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingProjectId(null);
          setDeleteError(null);
        }}
        isPending={deleteProject.isPending}
      />
    </div>
  );
}
