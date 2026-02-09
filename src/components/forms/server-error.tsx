/**
 * ServerError component
 * Displays server-side errors in an alert box with design system styling
 */

interface ServerErrorProps {
  message?: string;
}

export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    <div
      className="p-s bg-[var(--color-signal-red)]/10 border border-[var(--color-signal-red)] rounded-none text-[var(--color-signal-red)] body-small"
      role="alert"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
