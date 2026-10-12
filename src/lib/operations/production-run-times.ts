import type { EventInstant } from "@/schemas/event-instant";
import { hasLocalEventInstant, resolveEventInstant } from "./event-times";

/** Run names for the shared event-time resolver (`./event-times`). */
export const hasLocalRunInstant = hasLocalEventInstant;

export function resolveRunInstant(value: EventInstant, timeZone: string | undefined, field: "startTime" | "endTime"): Date {
  return resolveEventInstant(value, timeZone, [field]);
}
