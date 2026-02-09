"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { projectFormSchema, type ProjectFormData } from "@/schemas/projects";

interface ProjectFormProps {
  onSubmit: (data: ProjectFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  defaultValues?: ProjectFormData;
  submitLabel: string;
}

export function ProjectForm({
  onSubmit,
  onCancel,
  isSubmitting,
  defaultValues,
  submitLabel,
}: ProjectFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-m">
      <FormField id="name" label="Project Name" error={errors.name?.message}>
        <FormInput
          id="name"
          type="text"
          placeholder="e.g. Marketing Site"
          disabled={isSubmitting}
          error={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField
        id="description"
        label="Description (optional)"
        error={errors.description?.message}
      >
        <FormTextarea
          id="description"
          placeholder="Describe the purpose of this project"
          disabled={isSubmitting}
          error={!!errors.description}
          {...register("description")}
        />
      </FormField>

      <div className="flex items-center justify-end gap-s">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-l py-s border border-[var(--color-border-primary)] rounded-lg hover:bg-[var(--color-bg-secondary)] transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          className="px-l py-s bg-[var(--clr-dark-purple)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
