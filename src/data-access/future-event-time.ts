import { DomainError } from "@/lib/domain-errors";
import { getFutureEventFields } from "@/lib/future-event-times";

/**
 * Refuses submitted event instants after `now` (decision 56) as
 * `validation_failed`, one issue per field. `summary` words the message when
 * several fields are in the future; by default the first field's message.
 */
export function assertEventTimesNotFuture<Field extends string>(
  values: Readonly<Record<Field, Date | null | undefined>>,
  messages: Readonly<Record<Field, string>>,
  now: Date,
  summary: (fields: readonly Field[]) => string = (fields) => messages[fields[0]],
): void {
  const futureFields = getFutureEventFields(values, now);
  if (futureFields.length === 0) return;
  throw new DomainError("validation_failed", summary(futureFields), {
    issues: futureFields.map((field) => ({ path: [field], code: "validation_failed", message: messages[field] })),
  });
}
