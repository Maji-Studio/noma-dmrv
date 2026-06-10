/**
 * FormActions
 * Sticky form footer with Cancel + Submit buttons.
 * Used by all entity forms for consistent action placement.
 */

import { Button } from "@/components/ui";

interface FormActionsProps {
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  defaultSubmitLabel?: string;
  /** Block submit while a precondition is unmet (e.g. an unchecked ack). */
  submitDisabled?: boolean;
}

export function FormActions({
  onCancel,
  isSubmitting = false,
  submitLabel,
  defaultSubmitLabel = "Save",
  submitDisabled = false,
}: FormActionsProps) {
  return (
    <div className="sticky bottom-0 -mx-24 px-24 py-20 bg-[var(--color-background-white)] flex items-center justify-end gap-16 border-t border-[var(--color-border-secondary)]">
      {onCancel && (
        <Button type="button" variant="default" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      )}
      <Button type="submit" variant="primary" disabled={isSubmitting || submitDisabled}>
        {isSubmitting ? "Saving..." : submitLabel ?? defaultSubmitLabel}
      </Button>
    </div>
  );
}
