import { z } from "zod";
import { toActionError } from "@/lib/errors";

export function submissionStreamErrorMessage(error: unknown): string {
  return error instanceof z.ZodError
    ? `Validation error: ${error.issues.map((issue) => issue.message).join(", ")}`
    : toActionError(error, "The submission could not be completed. Try again.");
}
