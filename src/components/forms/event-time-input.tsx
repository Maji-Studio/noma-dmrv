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

import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import {
  AmbiguousLocalTimeError,
  combineDateAndTime,
  formatFacilityWallClock,
  NonexistentLocalTimeError,
} from "@/lib/date-utils";
import { FormError } from "./form-error";
import { FormInput } from "./form-input";

/** "YYYY-MM-DDTHH:MM" as a native datetime-local input emits it. */
const WALL_CLOCK_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export const SKIPPED_EVENT_TIME_MESSAGE =
  "This time does not exist on the facility clock because the clocks move forward for daylight saving. Enter a time outside the skipped hour.";
export const REPEATED_EVENT_TIME_MESSAGE =
  "This time happens twice on the facility clock because the clocks move back for daylight saving. Enter a time outside the repeated hour.";

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

/**
 * Why a typed wall clock was refused, when the reason is a daylight-saving
 * change on the facility clock; null for an accepted, empty or malformed
 * value, which the schema's own message covers.
 */
export function eventTimeRefusal(wallClock: string, timeZone: string): string | null {
  const match = WALL_CLOCK_PATTERN.exec(wallClock);
  if (!match) return null;
  try {
    combineDateAndTime(match[1], match[2], timeZone);
    return null;
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError) return SKIPPED_EVENT_TIME_MESSAGE;
    if (error instanceof AmbiguousLocalTimeError) return REPEATED_EVENT_TIME_MESSAGE;
    return null;
  }
}

interface RefusedWallClock {
  wallClock: string;
  message: string;
}

interface EventTimeInputProps<T extends FieldValues, TTransformed> {
  control: Control<T, unknown, TTransformed>;
  name: FieldPath<T>;
  id: string;
  /** The facility's IANA zone; see `useFacilityClock`. */
  timeZone: string;
  disabled?: boolean;
  /** Set by the enclosing `FormField` so its helper or error is announced. */
  "aria-describedby"?: string;
}

/**
 * A refused wall clock stays in the picker with its reason under it, so the
 * operator sees what they typed and why it cannot be stored. The field value
 * is still empty, so the form cannot save it.
 */
export function EventTimeInput<T extends FieldValues, TTransformed = T>({
  control,
  name,
  id,
  timeZone,
  disabled,
  "aria-describedby": describedBy,
}: EventTimeInputProps<T, TTransformed>) {
  const [refused, setRefused] = useState<RefusedWallClock | null>(null);
  const refusalId = `${id}-refusal`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        // A value set since the refusal (a reset, a later valid pick) wins.
        const shown = refused && !field.value ? refused : null;
        return (
          <>
            <FormInput
              id={id}
              ref={field.ref}
              name={field.name}
              type="datetime-local"
              disabled={disabled}
              error={!!fieldState.error || shown !== null}
              aria-describedby={[shown ? refusalId : null, describedBy].filter(Boolean).join(" ") || undefined}
              value={shown?.wallClock ?? eventTimeInputValue(field.value, timeZone)}
              onChange={(event) => {
                const wallClock = event.target.value;
                const message = eventTimeRefusal(wallClock, timeZone);
                setRefused(message ? { wallClock, message } : null);
                field.onChange(eventTimeFromInput(wallClock, timeZone));
              }}
              onBlur={field.onBlur}
            />
            <FormError id={refusalId} message={shown?.message} />
          </>
        );
      }}
    />
  );
}
