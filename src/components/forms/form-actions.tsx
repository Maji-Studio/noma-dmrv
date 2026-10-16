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
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { Notice } from "@/components/ui/notice";
import { useSubmitBlockedReason } from "@/components/ui/submit-block-context";
import { cn } from "@/lib/utils";
import {
  useSideSheetActions,
  type SideSheetActions,
} from "@/components/ui/entity-side-sheet/side-sheet-context";
import { ServerError } from "./server-error";

/** Room kept between a focused control and the sticky CTA row's top edge. */
const FOCUS_CLEARANCE_PX = 8;

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
  /** Rendered under `errorMessage`: detail about the records the refusal named. */
  errorAction?: React.ReactNode;
  submitLabel?: string;
  showSubmit?: boolean;
  submitVariant?: React.ComponentProps<typeof Button>["variant"];
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
  /** Route Cancel through FormDialog even for a non-sticky dialog footer. */
  guardDialogCancel?: boolean;
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
  errorAction,
  submitLabel,
  showSubmit = true,
  submitVariant = "primary",
  submittingLabel = "Saving...",
  defaultSubmitLabel = "Save",
  cancelLabel = "Cancel",
  submitDisabled = false,
  formId,
  sticky = true,
  guardDialogCancel = sticky,
  submitType = "submit",
  onSubmitClick,
}: FormActionsProps<TFieldValues, TContext, TTransformed>) {
  // A sticky CTA row inside an EntitySideSheet routes Cancel through the
  // sheet (edit -> back to read view, create -> guarded close) so every sheet
  // form behaves the same without per-list wiring. The caller's `onCancel`
  // still owns *presence*: no handler, no Cancel button. Nested inline forms
  // (sticky={false}) keep the caller-supplied handler by default.
  // Dialog footers can opt into its guard independently of sticky layout.
  const sheetActions = useSideSheetActions();
  const dialogActions = React.useContext(FormDialogContext);
  const inSheet = sticky && sheetActions !== null;
  const blockedReason = useSubmitBlockedReason();
  const blockedReasonId = React.useId();
  const inDialog = guardDialogCancel && dialogActions !== null;
  const handleCancel = onCancel
    ? inSheet
      ? sheetActions.cancel
      : inDialog
        ? dialogActions.cancel
        : onCancel
    : undefined;
  return (
    <>
      {control && dialogActions && (
        <DialogFormBridge control={control} actions={dialogActions} busy={isSubmitting} />
      )}
      {control && inSheet && (
        <SheetDirtyBridge control={control} reportDirty={sheetActions.reportDirty} />
      )}
    {(showSubmit || handleCancel || errorMessage) && <div
      ref={sticky ? reserveStickyFooterSpace : undefined}
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
      <ServerError message={errorMessage} action={errorAction} />
      <div className="flex items-center justify-start gap-16">
        {showSubmit && <Button
          type={submitType}
          variant={submitVariant}
          form={formId}
          onClick={onSubmitClick}
          disabled={isSubmitting || submitDisabled || !!blockedReason}
          aria-describedby={blockedReason ? blockedReasonId : undefined}
        >
          {isSubmitting ? submittingLabel : submitLabel ?? defaultSubmitLabel}
        </Button>}
        {handleCancel && (
          <Button type="button" variant="default" onClick={handleCancel} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
        )}
      </div>
      {showSubmit && blockedReason && (
        <Notice tone="info" id={blockedReasonId}>{blockedReason}</Notice>
      )}
    </div>}
    </>
  );
}

/**
 * Keeps keyboard focus clear of the sticky CTA row (WCAG 2.2 SC 2.4.11). The
 * browser's focus scrolling ignores sticky elements but honours
 * `scroll-padding`, so the row's height is reserved as `scroll-padding-bottom`
 * on its scroll container. The row grows when an action error shows, so its
 * size is observed rather than assumed. Ref callback; returns the cleanup.
 */
export function reserveStickyFooterSpace(footer: HTMLElement | null) {
  if (!footer || typeof ResizeObserver === "undefined") return;
  const scrollport = findScrollContainer(footer);
  if (!scrollport) return;
  const previous = scrollport.style.scrollPaddingBottom;
  const observer = new ResizeObserver(() => {
    scrollport.style.scrollPaddingBottom = `${footer.offsetHeight + FOCUS_CLEARANCE_PX}px`;
  });
  observer.observe(footer);
  return () => {
    observer.disconnect();
    scrollport.style.scrollPaddingBottom = previous;
  };
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
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

/** RHF state is synchronized into the dialog's imperative dismissal guard. */
function DialogFormBridge<TFieldValues extends FieldValues, TContext, TTransformed>({
  control,
  actions,
  busy,
}: {
  control: Control<TFieldValues, TContext, TTransformed>;
  actions: NonNullable<React.ContextType<typeof FormDialogContext>>;
  busy: boolean;
}) {
  const { isDirty, isSubmitting } = useFormState({ control });
  React.useEffect(() => {
    actions.report(control, { dirty: isDirty, busy: busy || isSubmitting });
    return () => actions.report(control, null);
  }, [actions, control, isDirty, busy, isSubmitting]);
  return null;
}
