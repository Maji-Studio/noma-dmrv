/**
 * FormActions
 * Form footer with Submit + Cancel buttons — the single CTA row pattern for
 * all entity forms: left-aligned, primary action first, nothing after it.
 * Sticky by default (side-sheet forms); pass `sticky={false}` for nested
 * inline forms (e.g. transport legs, child-entity editors).
 */
"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useSideSheetActions } from "@/components/ui/entity-side-sheet/side-sheet-context";
import { ServerError } from "./server-error";

interface FormActionsProps {
  onCancel?: () => void;
  isSubmitting?: boolean;
  /** Submission-level error rendered with the CTA footer. */
  errorMessage?: string;
  submitLabel?: string;
  submittingLabel?: string;
  defaultSubmitLabel?: string;
  /** Context-specific label for the secondary action. */
  cancelLabel?: string;
  /** Block submit while a precondition is unmet (e.g. an unchecked ack). */
  submitDisabled?: boolean;
  /**
   * Associate the submit button with a `<form id>` rendered elsewhere.
   * Lets the CTA row live outside the form element so extension content
   * (child-entity editors) can render between the fields and the CTA
   * without nesting forms.
   */
  formId?: string;
  /** Sticky footer (default) — disable for nested inline forms. */
  sticky?: boolean;
  /** Use `button` when actions render inside an owning parent form. */
  submitType?: "submit" | "button";
  /** Click handler for a non-submit action button. */
  onSubmitClick?: () => void;
}

export function FormActions({
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  submittingLabel = "Saving...",
  defaultSubmitLabel = "Save",
  cancelLabel = "Cancel",
  submitDisabled = false,
  formId,
  sticky = true,
  submitType = "submit",
  onSubmitClick,
}: FormActionsProps) {
  // A sticky CTA row inside an EntitySideSheet routes Cancel through the
  // sheet (edit -> back to read view, create -> guarded close) so every sheet
  // form behaves the same without per-list wiring. Nested inline forms
  // (sticky={false}) and forms inside a Modal (context barrier) keep the
  // caller-supplied handler.
  const sheetActions = useSideSheetActions();
  const handleCancel =
    sticky && sheetActions ? sheetActions.cancel : onCancel;
  return (
    <div
      className={cn(
        "flex flex-col gap-16 border-t border-[var(--color-border-secondary)]",
        sticky
          // `mt-auto!` pins the footer to the bottom of a fill-height flex-column
          // form on short forms (overriding the form's `space-y` margin); on
          // long forms there is no free space, so `sticky bottom-0` keeps the
          // action error and CTA in view while the body scrolls.
          ? "sticky bottom-0 z-20 mt-auto! -mx-24 px-24 py-20 bg-[var(--color-background-white)]"
          : "pt-20"
      )}
    >
      <ServerError message={errorMessage} />
      <div className="flex items-center justify-start gap-16">
        <Button
          type={submitType}
          variant="primary"
          form={formId}
          onClick={onSubmitClick}
          disabled={isSubmitting || submitDisabled}
        >
          {isSubmitting ? submittingLabel : submitLabel ?? defaultSubmitLabel}
        </Button>
        {handleCancel && (
          <Button type="button" variant="default" onClick={handleCancel} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
