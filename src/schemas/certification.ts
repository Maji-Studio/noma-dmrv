import { z } from "zod";
import { emptyToNull } from "@/schemas/helpers";

const DATE_PART_PAD_LENGTH = 2;

export const saveMappingSchema = z.object({
  facilityId: z.string().uuid(),
  externalProjectId: z.string().min(1, "Pick an Isometric project"),
  protocolSlug: z.string().min(1),
  protocolVersion: emptyToNull.or(z.string().min(1)).nullable().optional(),
  defaultRemovalTemplateId: emptyToNull
    .or(z.string().min(1))
    .nullable()
    .optional(),
  confirmProduction: z.boolean().optional(),
});

export type SaveMappingInput = z.infer<typeof saveMappingSchema>;

export const submitCreditBatchSchema = z.object({
  creditBatchId: z.string().uuid(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitCreditBatchInput = z.infer<typeof submitCreditBatchSchema>;

export const createGhgStatementSchema = z.object({
  endOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .refine((value) => value <= todayLocalDateString(), {
      message: "End date cannot be in the future",
    }),
  confirmProduction: z.boolean().optional(),
});

export type CreateGhgStatementInput = z.infer<
  typeof createGhgStatementSchema
>;

export const submitGhgStatementSchema = z.object({
  submissionId: z.string().uuid(),
  reportUrl: z
    .string()
    .url("Enter a valid report URL")
    .refine((value) => value.startsWith("https://"), {
      message: "Report URL must use HTTPS",
    }),
  summaryOfChanges: emptyToNull.or(z.string().min(1)).nullable().optional(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitGhgStatementInput = z.infer<
  typeof submitGhgStatementSchema
>;

function todayLocalDateString(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(DATE_PART_PAD_LENGTH, "0");
  const day = String(date.getDate()).padStart(DATE_PART_PAD_LENGTH, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
