/**
 * FormActions
 * Form footer with Submit + Cancel buttons — the single CTA row pattern for
 * all entity forms: left-aligned, primary action first, nothing after it.
 * Sticky by default (side-sheet forms); pass `sticky={false}` for nested
 * inline forms (e.g. transport legs, child-entity editors).
 */
"use client";

import * as React from "react";
import {
  useFormState,
  type Control,
  type FieldValues,
} from "react-hook-form";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  useSideSheetActions,
  type SideSheetActions,
} from "@/components/ui/entity-side-sheet/side-sheet-context";
import { ServerError } from "./server-error";

interface FormActionsProps<
  TFieldValues extends FieldValues = FieldValues,
  TContext = unknown,
  TTransformed = TFieldValues,
> {
  /**
   * Cancel handler. Presence controls whether a Cancel button renders at all;
   * inside an EntitySideSheet the click is routed through the sheet's guarded
   * cancel (edit -> back to view, create -> close) instead of this handler.
   */
  onCancel?: () => void;
  /**
   * The owning form's RHF `control`. Inside an EntitySideSheet this feeds the
   * sheet's unsaved-changes guard with the authoritative `formState.isDirty`,
   * which sees programmatic `setValue` from custom widgets (entity selects,
   * radio cards, pickers) that the sheet's native-event heuristic misses.
   * Pass it from every sheet form.
   */
  control?: Control<TFieldValues, TContext, TTransformed>;
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

export function FormActions<
  TFieldValues extends FieldValues = FieldValues,
  TContext = unknown,
  TTransformed = TFieldValues,
>({
  onCancel,
  control,
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
}: FormActionsProps<TFieldValues, TContext, TTransformed>) {
  // A sticky CTA row inside an EntitySideSheet routes Cancel through the
  // sheet (edit -> back to read view, create -> guarded close) so every sheet
  // form behaves the same without per-list wiring. The caller's `onCancel`
  // still owns *presence*: no handler, no Cancel button. Nested inline forms
  // (sticky={false}) and forms inside a Modal (context barrier) keep the
  // caller-supplied handler.
  const sheetActions = useSideSheetActions();
  const inSheet = sticky && sheetActions !== null;
  const handleCancel = onCancel
    ? inSheet
      ? sheetActions.cancel
      : onCancel
    : undefined;
  return (
    <>
      {control && inSheet && (
        <SheetDirtyBridge control={control} reportDirty={sheetActions.reportDirty} />
      )}
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
    </>
  );
}

/**
 * Subscribes to the owning form's dirty state and mirrors it into the sheet's
 * unsaved-changes guard. Rendered only when both a `control` and a sheet
 * context exist, so `useFormState` always has a control to subscribe to.
 */
function SheetDirtyBridge<
  TFieldValues extends FieldValues,
  TContext,
  TTransformed,
>({
  control,
  reportDirty,
}: {
  control: Control<TFieldValues, TContext, TTransformed>;
  reportDirty: SideSheetActions["reportDirty"];
}) {
  const { isDirty } = useFormState({ control });
  // Sanctioned useEffect: syncing React state into the sheet's imperative
  // guard ref is an external-system write, not derivable during render.
  React.useEffect(() => {
    reportDirty(isDirty);
  }, [isDirty, reportDirty]);
  return null;
}
