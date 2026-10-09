import type { z } from "zod";
import type { productionRunInstantSchema } from "@/schemas/production-run-input";
import { combineDateAndTime, NonexistentLocalTimeError, AmbiguousLocalTimeError } from "@/lib/date-utils";
import { productionRunValidationError } from "@/lib/production-run-domain-errors";

type RunInstant = z.output<typeof productionRunInstantSchema>;

export function hasLocalRunInstant(...values: (RunInstant | null | undefined)[]): boolean {
  return values.some((value) => value != null && typeof value === "object" && !(value instanceof Date));
}

export function resolveRunInstant(value: RunInstant, timeZone: string | undefined, field: "startTime" | "endTime"): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (!timeZone) throw new Error("Local run times require the effective facility time zone.");
  try {
    return combineDateAndTime(value.date, value.time, timeZone);
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError || error instanceof AmbiguousLocalTimeError) {
      throw productionRunValidationError(error.message, [field]);
    }
    throw error;
  }
}
