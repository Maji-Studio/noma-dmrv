import { z } from "zod";
import { emptyToNull } from "@/schemas/helpers";
import { formatLocalDate, parseLocalDateString } from "@/lib/date-utils";

function isValidCalendarDate(value: string): boolean {
  try {
    parseLocalDateString(value);
    return true;
  } catch {
    return false;
  }
}

const httpsUrlSchema = z
  .string()
  .url({ error: "Enter a valid report URL" })
  .refine((value) => value.startsWith("https://"), {
    error: "Report URL must use HTTPS",
  });

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
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter a valid date" })
    .refine(isValidCalendarDate, { error: "Invalid calendar date" })
    .refine((value) => value <= formatLocalDate(new Date()), {
      error: "End date cannot be in the future",
    }),
  confirmProduction: z.boolean().optional(),
});

export type CreateGhgStatementInput = z.infer<
  typeof createGhgStatementSchema
>;

export const submitGhgStatementDialogSchema = z.object({
  reportUrl: httpsUrlSchema,
  summaryOfChanges: z.string().optional(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitGhgStatementDialogInput = z.infer<
  typeof submitGhgStatementDialogSchema
>;

export function buildSubmitGhgStatementDialogSchema(args: {
  isResubmit: boolean;
  isProduction: boolean;
}) {
  return submitGhgStatementDialogSchema.check((ctx) => {
    const value = ctx.value;
    if (args.isResubmit && !value.summaryOfChanges?.trim()) {
      ctx.issues.push({
        code: "custom",
        input: value,
        path: ["summaryOfChanges"],
        message: "Summary of changes is required",
      });
    }
    if (args.isProduction && value.confirmProduction !== true) {
      ctx.issues.push({
        code: "custom",
        input: value,
        path: ["confirmProduction"],
        message: "Confirm production submission to continue",
      });
    }
  });
}

export const submitGhgStatementSchema = z.object({
  submissionId: z.string().uuid(),
  reportUrl: httpsUrlSchema,
  summaryOfChanges: emptyToNull.or(z.string().min(1)).nullable().optional(),
  confirmProduction: z.boolean().optional(),
});

export type SubmitGhgStatementInput = z.infer<
  typeof submitGhgStatementSchema
>;

