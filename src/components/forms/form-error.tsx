/**
 * FormError component
 * Displays field-level validation errors with design system styling
 */

import { cn } from "@/lib/utils";

interface FormErrorProps {
  message?: string;
  /** Optional id so a control can reference this error via aria-describedby. */
  id?: string;
}

export function FormError({ message, id }: FormErrorProps) {
  if (!message) return null;

  return (
    <p
      id={id}
      className="body-caption text-[var(--color-signal-red)] mt-6"
      role="alert"
      aria-live="polite"
    >
      {message}
    </p>
  );
}

/**
 * A field's error line as its own grid row, full width, directly under the
 * row of the field it belongs to. Pair it with `<FormField errorOutside>` and
 * give it the grid placement (`md:col-span-2 md:row-start-N`) in `className`.
 * The negative margin takes back the grid's row gap so the line sits where an
 * in-field error would.
 */
export function FieldErrorRow({ id, message, className }: FormErrorProps & { className?: string }) {
  if (!message) return null;
  return (
    <div className={cn("-mt-20", className)}>
      <FormError id={id} message={message} />
    </div>
  );
}
