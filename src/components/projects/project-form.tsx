"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-24">
      <FormField id="name" label="Project Name" error={errors.name?.message} required>
        <FormInput
          id="name"
          type="text"
          placeholder="e.g. Dark Earth Carbon Tanzania MRV"
          disabled={isSubmitting}
          error={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField
        id="description"
        label="Description"
        error={errors.description?.message}
      >
        <FormTextarea
          id="description"
          placeholder="Track feedstock sourcing, pyrolysis runs, biochar deliveries, field applications, and carbon credit issuance."
          disabled={isSubmitting}
          error={!!errors.description}
          {...register("description")}
        />
      </FormField>

      <div className="flex items-center justify-end gap-16">
        {onCancel ? (
          <Button size="large" variant="default" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="large" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
