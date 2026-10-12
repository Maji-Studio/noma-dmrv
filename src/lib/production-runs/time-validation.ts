import { getFutureEventFields } from "@/lib/future-event-times";

export const PRODUCTION_RUN_FUTURE_TIME_MESSAGES = {
  startTime:
    "Start time cannot be in the future. Enter a time at or before now.",
  endTime: "End time cannot be in the future. Enter a time at or before now.",
} as const;

export type ProductionRunFutureTimeField =
  keyof typeof PRODUCTION_RUN_FUTURE_TIME_MESSAGES;

export function getFutureProductionRunTimeFields(
  input: {
    startTime: Date | null | undefined;
    endTime: Date | null | undefined;
  },
  now: Date,
): ProductionRunFutureTimeField[] {
  return getFutureEventFields({ startTime: input.startTime, endTime: input.endTime }, now);
}

export function formatProductionRunFutureTimeError(
  fields: readonly ProductionRunFutureTimeField[],
): string {
  if (fields.length === 1) {
    return PRODUCTION_RUN_FUTURE_TIME_MESSAGES[fields[0]];
  }
  return "Start time and end time cannot be in the future. Enter times at or before now.";
}
