/**
 * FormError component
 * Displays field-level validation errors with design system styling
 */

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
