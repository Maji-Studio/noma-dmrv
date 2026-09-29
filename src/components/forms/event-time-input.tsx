"use client";

/**
 * Date and time of a physical stock event (ADR 0029 amendment).
 *
 * The form value is an ISO 8601 UTC instant, which is what the stock schemas
 * validate and the ledger stores. The native picker shows it on the viewer's
 * own clock, the same clock `formatDateTime` uses to display it later. The
 * picker has minute precision: an untouched default keeps its seconds, an
 * edited value stores the minute the operator picked.
 */

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { formatLocalDateTime } from "@/lib/date-utils";
import { FormInput } from "./form-input";

/** "YYYY-MM-DDTHH:MM" as a native datetime-local input emits it. */
const WALL_CLOCK_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Instant → the picker's local wall clock; anything unparsable shows empty. */
export function eventTimeInputValue(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "" : formatLocalDateTime(instant);
}

/**
 * The picker's local wall clock → instant. A cleared or malformed value stays
 * an empty string, so the schema's own message reports it.
 */
export function eventTimeFromInput(wallClock: string): string {
  if (!WALL_CLOCK_PATTERN.test(wallClock)) return "";
  // A bare date-time string without a zone parses on the local clock.
  const instant = new Date(wallClock);
  return Number.isNaN(instant.getTime()) ? "" : instant.toISOString();
}

interface EventTimeInputProps<T extends FieldValues, TTransformed> {
  control: Control<T, unknown, TTransformed>;
  name: FieldPath<T>;
  id: string;
  disabled?: boolean;
}

export function EventTimeInput<T extends FieldValues, TTransformed = T>({ control, name, id, disabled }: EventTimeInputProps<T, TTransformed>) {
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
          value={eventTimeInputValue(field.value)}
          onChange={(event) => field.onChange(eventTimeFromInput(event.target.value))}
          onBlur={field.onBlur}
        />
      )}
    />
  );
}
