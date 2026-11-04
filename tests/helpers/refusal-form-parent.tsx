import { useState, type ReactNode } from "react";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { ActionError } from "@/lib/action-error";
import type { DomainErrorCode } from "@/lib/domain-errors";

/** A refusal as the server action sends it: one issue, one path. */
export function fieldRefusal(path: (string | number)[], message: string, code: DomainErrorCode = "validation_failed") {
  return new ActionError({ error: message, code, issues: [{ path, code, message }] });
}

interface ParentProps {
  refusal: unknown;
  fallback: string;
  /** Renders the form with the submit handler that hands the refusal to the form's handler. */
  children: (props: {
    onSubmit: (data: unknown, onRefusal: SaveRefusalHandler) => void;
    errorMessage?: string;
  }) => ReactNode;
}

/**
 * A parent like the sheets and quick-add dialogs: it catches a refused save,
 * gives the form's handler the caught error and its fallback, and passes the
 * footer back through, null included.
 */
export function RefusalParent({ refusal, fallback, children }: ParentProps) {
  const [footer, setFooter] = useState<string | null>(null);
  return (
    <>
      {children({
        onSubmit: (_data, onRefusal) => setFooter(onRefusal(refusal, fallback)),
        errorMessage: footer ?? undefined,
      })}
      <output data-testid="footer">{footer ?? "none"}</output>
    </>
  );
}
