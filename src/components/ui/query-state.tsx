import type { ReactNode } from "react";

/** Renders loading before errors or missing data, wrapping only status paragraphs. */
interface QueryStateProps<T> {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  loadingMessage: string;
  errorMessage: string;
  /** Wraps the loading and error paragraphs; the caller's own shell. */
  wrap?: (children: ReactNode) => ReactNode;
  children: (data: T) => ReactNode;
}

export function QueryState<T>({
  isLoading,
  error,
  data,
  loadingMessage,
  errorMessage,
  wrap,
  children,
}: QueryStateProps<T>) {
  if (isLoading) {
    const message = (
      <p className="body-small text-[var(--color-text-tertiary)]">
        {loadingMessage}
      </p>
    );
    return wrap ? wrap(message) : message;
  }

  if (error || !data) {
    const message = (
      <p className="body-small text-[var(--color-signal-red)]">
        {errorMessage}
      </p>
    );
    return wrap ? wrap(message) : message;
  }

  return children(data);
}
