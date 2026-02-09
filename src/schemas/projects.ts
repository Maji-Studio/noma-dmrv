import { z } from "zod";

export const projectFormSchema = z.object({
  name: z.string().min(1, "Project name is required").max(120, "Project name must be less than 120 characters"),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

export const createProjectSchema = projectFormSchema;

export const updateProjectSchema = projectFormSchema.partial().extend({
  projectId: z.string().uuid(),
});

export const deleteProjectSchema = z.object({
  projectId: z.string().uuid(),
});

export type ProjectFormData = z.infer<typeof projectFormSchema>;
