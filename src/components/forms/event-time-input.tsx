"use client";

/**
 * Date and time of a physical stock event (ADR 0029 amendment).
 *
 * The form value is an ISO 8601 UTC instant, which is what the stock schemas
 * validate and the ledger stores. The native picker shows it on the
 * facility's clock, the same clock production run times are entered on, so
 * every viewer reads one wall clock. The picker has minute precision: an
 * untouched default keeps its seconds, an edited value stores the minute the
 * operator picked.
 */

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { combineDateAndTime, formatFacilityWallClock } from "@/lib/date-utils";
import { FormInput } from "./form-input";

/** "YYYY-MM-DDTHH:MM" as a native datetime-local input emits it. */
const WALL_CLOCK_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** Instant → the picker's facility wall clock; anything unparsable shows empty. */
export function eventTimeInputValue(value: unknown, timeZone: string): string {
  if (typeof value !== "string" || value === "") return "";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "" : formatFacilityWallClock(instant, timeZone);
}

/**
 * The picker's facility wall clock → instant. A cleared, malformed or
 * nonexistent (DST gap) or ambiguous (DST fold) wall clock stays an empty
 * string, so the schema reports it instead of a silently shifted time.
 */
export function eventTimeFromInput(wallClock: string, timeZone: string): string {
  const match = WALL_CLOCK_PATTERN.exec(wallClock);
  if (!match) return "";
  try {
    const instant = combineDateAndTime(match[1], match[2], timeZone);
    return Number.isNaN(instant.getTime()) ? "" : instant.toISOString();
  } catch {
    return "";
  }
}

interface EventTimeInputProps<T extends FieldValues, TTransformed> {
  control: Control<T, unknown, TTransformed>;
  name: FieldPath<T>;
  id: string;
  /** The facility's IANA zone; see `useFacilityClock`. */
  timeZone: string;
  disabled?: boolean;
}

export function EventTimeInput<T extends FieldValues, TTransformed = T>({ control, name, id, timeZone, disabled }: EventTimeInputProps<T, TTransformed>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormInput
          id={id}
          ref={field.ref}
          name={field.name}
          type="datetime-local"
          disabled={disabled}
          error={!!fieldState.error}
          value={eventTimeInputValue(field.value, timeZone)}
          onChange={(event) => field.onChange(eventTimeFromInput(event.target.value, timeZone))}
          onBlur={field.onBlur}
        />
      )}
    />
  );
}
