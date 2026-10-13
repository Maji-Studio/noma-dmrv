/**
 * The one "valid IANA timezone" rule. Facility form, create and update,
 * facility filters and the organization defaults all use it, so a zone the
 * picker offers is a zone the server accepts, and nothing else is.
 *
 * Lives beside `helpers.ts` rather than in it: the catalogue it checks against
 * is a few hundred zones of data, and `helpers.ts` is imported by nearly every
 * form.
 */
import { z } from "zod";
import { isValidIanaTimezone } from "@/lib/timezones";

export const TIMEZONE_REQUIRED_MESSAGE = "Timezone is required";
export const TIMEZONE_INVALID_MESSAGE = "Choose a timezone from the list.";

/** A canonical IANA zone id the picker offers. */
export function ianaTimezoneSchema(requiredMessage = TIMEZONE_REQUIRED_MESSAGE) {
  return z
    .string({ message: requiredMessage })
    .refine(isValidIanaTimezone, { message: TIMEZONE_INVALID_MESSAGE });
}

/** Empty input counts as "not chosen", which the required message names. */
export function requiredTimezoneSchema() {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    ianaTimezoneSchema(),
  );
}

/** Empty input becomes null: an optional timezone nobody has chosen. */
export function optionalTimezoneSchema() {
  return z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    ianaTimezoneSchema().nullable(),
  );
}
