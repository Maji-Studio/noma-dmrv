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
  const fields: ProductionRunFutureTimeField[] = [];
  if (input.startTime && input.startTime.getTime() > now.getTime()) {
    fields.push("startTime");
  }
  if (input.endTime && input.endTime.getTime() > now.getTime()) {
    fields.push("endTime");
  }
  return fields;
}

export function formatProductionRunFutureTimeError(
  fields: readonly ProductionRunFutureTimeField[],
): string {
  if (fields.length === 1) {
    return PRODUCTION_RUN_FUTURE_TIME_MESSAGES[fields[0]];
  }
  return "Start time and end time cannot be in the future. Enter times at or before now.";
}
