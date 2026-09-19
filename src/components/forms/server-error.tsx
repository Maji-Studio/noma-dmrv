/**
 * ServerError component
 * Displays server-side errors in an alert box with design system styling
 */

import type { ReactNode } from "react";

interface ServerErrorProps {
  message?: string;
  /** Detail about the records the refusal named, rendered under the message. */
  action?: ReactNode;
}

export function ServerError({ message, action }: ServerErrorProps) {
  if (!message) return null;

  return (
    <div
      className="flex flex-col items-start gap-12 p-16 bg-[var(--color-signal-red)]/10 border border-[var(--color-signal-red)] rounded-none text-[var(--color-signal-red)] body-small"
      role="alert"
      aria-live="polite"
    >
      <span>{message}</span>
      {action}
    </div>
  );
}
