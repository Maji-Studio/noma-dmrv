/**
 * FormError component
 * Displays field-level validation errors with design system styling
 */

interface FormErrorProps {
  message?: string;
}

export function FormError({ message }: FormErrorProps) {
  if (!message) return null;

  return (
    <p
      className="body-small text-[var(--color-signal-red)] mt-xs"
      role="alert"
      aria-live="polite"
    >
      {message}
    </p>
  );
}
