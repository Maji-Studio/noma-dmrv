/**
 * Operator events cannot happen after the server clock (decision 56): run
 * start and end, output-stock movements, product placement. Backdating stays
 * allowed. Kept free of server-only imports so form schemas can share it.
 */

/** The fields whose instant is after `now`, in the order given. An instant equal to `now` is allowed. */
export function getFutureEventFields<Field extends string>(
  values: Readonly<Record<Field, Date | null | undefined>>,
  now: Date,
): Field[] {
  return (Object.keys(values) as Field[]).filter((field) => {
    const value = values[field];
    return value != null && value.getTime() > now.getTime();
  });
}
