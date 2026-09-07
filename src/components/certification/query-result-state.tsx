import type { ReactNode } from "react";

/** Renders loading before errors or missing data, wrapping only status paragraphs. */
interface QueryResultStateProps<T> {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  loadingMessage: string;
  errorMessage: string;
  /** Required caller-provided shell for the loading and error paragraphs. */
  wrap: (children: ReactNode) => ReactNode;
  children: (data: T) => ReactNode;
}

export function QueryResultState<T>({
  isLoading,
  error,
  data,
  loadingMessage,
  errorMessage,
  wrap,
  children,
}: QueryResultStateProps<T>) {
  if (isLoading) {
    const message = (
      <p className="body-small text-[var(--color-text-tertiary)]">
        {loadingMessage}
      </p>
    );
    return wrap(message);
  }

  if (error || !data) {
    const message = (
      <p className="body-small text-[var(--color-signal-red)]">
        {errorMessage}
      </p>
    );
    return wrap(message);
  }

  return children(data);
}
