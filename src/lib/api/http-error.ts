import type { z } from "zod";

/** Transport refusals, separate from operation/domain failures. */
export class ApiHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly current?: unknown, readonly issues?: z.core.$ZodIssue[]) {
    super(message);
  }
}
