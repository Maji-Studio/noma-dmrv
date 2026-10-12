import type { EventInstant } from "@/schemas/event-instant";
import { combineDateAndTime, NonexistentLocalTimeError, AmbiguousLocalTimeError } from "@/lib/date-utils";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

/** True when any value is a facility-local `{ date, time }`, so the caller must read the facility zone. */
export function hasLocalEventInstant(...values: (EventInstant | null | undefined)[]): boolean {
  return values.some((value) => value != null && typeof value === "object" && !(value instanceof Date));
}

/**
 * The instant an event happened. Offset strings and Dates are already
 * instants; a local `{ date, time }` is read in the facility zone. A DST gap
 * or a repeated fall-back time is refused on `path`, never guessed.
 */
export function resolveEventInstant(value: EventInstant, timeZone: string | undefined, path: (string | number)[]): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (!timeZone) throw new Error("Local event times require the effective facility time zone.");
  try {
    return combineDateAndTime(value.date, value.time, timeZone);
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError || error instanceof AmbiguousLocalTimeError) {
      throw new DomainError("validation_failed", error.message, {
        issues: [{ path, code: "validation_failed", message: new SafeError(error.message).message }],
      });
    }
    throw error;
  }
}
