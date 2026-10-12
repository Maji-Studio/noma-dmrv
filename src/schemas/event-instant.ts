import { z } from "zod";
import { LOCAL_TIME_PATTERN } from "./helpers";
import { publishedJsonSchemas } from "./published-json-schema";

const EVENT_INSTANT_GUIDANCE = "Add an explicit offset (Z or +hh:mm), or send { date, time }.";

/** Zod's ISO date-time also takes HH:MM; RFC 3339 requires the seconds. */
const RFC3339_SECONDS_PATTERN = /T\d{2}:\d{2}:\d{2}/;

/** An RFC 3339 instant with an explicit offset and seconds, as the published `date-time` format requires. */
export function offsetInstantSchema(message?: string) {
  return z.iso.datetime({ offset: true, message }).refine((value) => RFC3339_SECONDS_PATTERN.test(value), { message: "Include seconds, as in 2026-10-12T09:30:00Z." });
}

const offsetInstant = offsetInstantSchema(EVENT_INSTANT_GUIDANCE);
const localInstant = z.strictObject({ date: z.iso.date().describe("Calendar date in the effective facility time zone, YYYY-MM-DD."), time: z.string().regex(LOCAL_TIME_PATTERN).describe("Facility-local wall time, HH:MM. DST gaps and ambiguous repeated times are refused.") });
const wireInstant = z.union([offsetInstant, localInstant]).describe("An RFC 3339 instant with explicit offset, or a date/time in the effective facility zone.");

/**
 * When an operator event happened (decision 40): an RFC 3339 instant with an
 * explicit offset, or a facility-local `{ date, time }` that
 * `resolveEventInstant` turns into an instant in the facility zone. A
 * date-time without an offset is refused. Native Dates are accepted for
 * validated server actions only; the published contract lists the two wire shapes.
 */
export const eventInstantSchema = z.union([z.date(), offsetInstant, localInstant], { error: EVENT_INSTANT_GUIDANCE })
  .register(publishedJsonSchemas, { jsonSchema: z.toJSONSchema(wireInstant) });

export type EventInstant = z.output<typeof eventInstantSchema>;
