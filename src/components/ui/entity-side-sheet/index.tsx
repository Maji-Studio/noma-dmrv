/**
 * Entity Side Sheet
 *
 * Unified side panel for viewing and editing entities. Combines the former
 * EntityDetailPanel (view) and SlideOverPanel form wrapper (edit/create)
 * into a single component that toggles modes in-place — no close/reopen flash.
 *
 * Modes:
 * - `view`   — read-only detail sections (row click)
 * - `edit`   — entity form rendered as children (Edit button or action column)
 * - `create` — entity form, no back-to-view toggle (New Entity button)
 */
"use client";

import * as React from "react";
import { FormDetailProvider, FormDetailControl } from "@/components/forms/form-detail-context";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { Button } from "@/components/ui/button";
import { DiscardChangesDialog } from "@/components/ui/discard-changes-dialog";
import {
  DetailSpine,
  type DetailPanelSection,
} from "@/components/ui/detail-panel";
import { SideSheetActionsContext } from "./side-sheet-context";
import { SubmitBlockContext, type SubmitBlock } from "@/components/ui/submit-block-context";

/* -------------------------------------------------------------------------------------------------
 * Back Arrow Icon
 * -----------------------------------------------------------------------------------------------*/

function ArrowLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

type SideSheetMode = "view" | "edit" | "create";

interface EntitySideSheetProps {
  /**
   * Explicit opt-in: `true` in every mode, `"view"` in saved read mode only,
   * `"form"` in create and edit only (a read view with nothing optional).
   */
  detailToggle?: boolean | "view" | "form";
  detailScope?: string;
  /** Controlled open state */
  open: boolean;
  /** Callback when the panel should close */
  onOpenChange: (open: boolean) => void;
  /** Return false to veto a create/edit close attempt. */
  onCloseAttempt?: () => boolean;
  /** Current display mode */
  mode: SideSheetMode;
  /** Callback when the mode changes (view ↔ edit) */
  onModeChange: (mode: SideSheetMode) => void;
  /** Panel title (entity code or "Create Entity") */
  title: string;
  /** Optional subtitle (entity name or helper text) */
  subtitle?: string;
  /** A chip beside the title in view and edit mode (the record lock chip). */
  titleBadge?: React.ReactNode;
  /** Edit-mode banner above the form (the record lock line). */
  editNotice?: React.ReactNode;
  /**
   * Edit mode: why the form cannot save. Save turns off with the reason
   * beside it; a `readOnly` block also disables every field and offers only
   * the way back. The draft stays in both cases.
   */
  submitBlock?: SubmitBlock | null;
  /** View-mode section config — rendered as read-only detail fields */
  sections?: DetailPanelSection[];
  /** Mirror a paired edit form's FormSpine numbering in read mode. */
  numberedSections?: boolean;
  /**
   * Optional view-mode body extension. When provided, renders below the
   * default `sections` so callers can mount interactive content (extra
   * cards, dialog openers). Edit/create modes still use `children`.
   *
   * Note: there is intentionally no edit-mode equivalent — nothing may render
   * after the form's CTA row. Edit-mode extensions (child-entity editors)
   * must be passed as the form component's `children` so they render between
   * the fields and the CTA.
   */
  viewModeChildren?: React.ReactNode;
  /**
   * View-mode banner rendered before the sections, so a state that changes how
   * the whole record reads (for example "archived") is seen first.
   */
  viewModeNotice?: React.ReactNode;
  /** Label for the Edit button shown in view-mode footer */
  editLabel?: string;
  /** Whether the view-mode footer exposes the edit action. */
  canEdit?: boolean;
  /** The form component rendered in edit/create mode */
  children: React.ReactNode;
  /** Panel width */
  size?: "default" | "narrow" | "wide" | "full";
}

/* -------------------------------------------------------------------------------------------------
 * EntitySideSheet
 * -----------------------------------------------------------------------------------------------*/

function EntitySideSheet({
  detailToggle = false,
  detailScope = "",
  open,
  onOpenChange,
  onCloseAttempt,
  mode,
  onModeChange,
  title,
  subtitle,
  titleBadge,
  editNotice,
  submitBlock,
  sections,
  numberedSections = false,
  viewModeChildren,
  viewModeNotice,
  editLabel = "Edit",
  canEdit = true,
  children,
  size = "wide",
}: EntitySideSheetProps) {
  const isViewMode = mode === "view";
  const editBlock = mode === "edit" ? submitBlock ?? null : null;

  const bodyRef = React.useRef<HTMLDivElement>(null);
  // Dirty tracking is two sources OR-ed together: a native input/change
  // heuristic (covers plain fields even in forms that don't report), and the
  // form's authoritative RHF `formState.isDirty` via `reportDirty` (covers
  // programmatic setValue from custom widgets the heuristic can't see).
  const dirtyRef = React.useRef(false);
  const reportedDirtyRef = React.useRef(false);
  const isDirty = () => dirtyRef.current || reportedDirtyRef.current;
  // A close/back attempt that hit unsaved changes and awaits confirmation.
  const [pendingDiscard, setPendingDiscard] = React.useState<
    "close" | "view" | null
  >(null);

  // Imperative scrollport work (sanctioned useEffect): the body element
  // persists across view -> edit, so without a reset the edit form inherits
  // the read view's scroll offset and opens mid-record. Also moves focus to
  // the first field so keyboard entry starts at the top of the form.
  React.useEffect(() => {
    dirtyRef.current = false;
    reportedDirtyRef.current = false;
    setPendingDiscard(null);
    if (!open) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = 0;
    if (mode === "view") return;
    const frame = requestAnimationFrame(() => {
      const firstField = body.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled])'
      );
      firstField?.focus({ preventScroll: true });
      body.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, mode, detailScope]);

  function confirmDiscard(action: "close" | "view") {
    if (action === "close") onOpenChange(false);
    else onModeChange("view");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isViewMode) {
      if (onCloseAttempt && !onCloseAttempt()) return;
      if (isDirty()) {
        setPendingDiscard("close");
        return;
      }
    }
    onOpenChange(nextOpen);
  }

  function backToView() {
    if (isDirty()) {
      setPendingDiscard("view");
      return;
    }
    onModeChange("view");
  }

  // Sheet-level Cancel (consumed by sticky FormActions): edit returns to the
  // read view it came from, create closes, both behind the dirty guard.
  const sheetActions = {
    cancel: () => {
      if (mode === "edit") backToView();
      else handleOpenChange(false);
    },
    reportDirty: (dirty: boolean) => {
      reportedDirtyRef.current = dirty;
    },
  };

  // React propagates synthetic events from portaled children (nested dialogs)
  // through the component tree; only events from real DOM descendants of the
  // body may mark the sheet dirty, or typing in a quick-add dialog would
  // trigger a spurious discard prompt on a clean sheet.
  const markDirtyFromBody = (event: React.SyntheticEvent) => {
    if (!bodyRef.current?.contains(event.target as Node)) return;
    if ((event.target as Element).closest?.("[data-presentation-control]")) return;
    dirtyRef.current = true;
  };

  const showDetailToggle = detailToggle === true
    || (detailToggle === "view" && isViewMode)
    || (detailToggle === "form" && !isViewMode);
  return (
    <FormDetailProvider scope={`${open}:${mode}:${detailScope}`} enabled={showDetailToggle}>
    <SlideOverPanel.Root open={open} onOpenChange={handleOpenChange}>
      <SlideOverPanel.Content size={size}>
        {/* Header */}
        <SlideOverPanel.Header showClose actions={showDetailToggle ? <FormDetailControl /> : undefined}>
          <div className="flex min-w-0 items-center gap-12">
            {/* Back arrow: only in edit mode when coming from view (not create) */}
            {mode === "edit" && (
              <Button
                variant="noOutline"
                size="icon"
                onClick={backToView}
                className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                aria-label="Back to view"
              >
                <ArrowLeftIcon />
              </Button>
            )}
            <div className="flex flex-col gap-4 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-8">
                <SlideOverPanel.Title>{title}</SlideOverPanel.Title>
                {mode !== "create" && titleBadge}
              </div>
              {subtitle && (
                <SlideOverPanel.Description className={showDetailToggle ? "truncate" : undefined}>
                  {subtitle}
                </SlideOverPanel.Description>
              )}
            </div>
          </div>
        </SlideOverPanel.Header>

        {/* Body */}
        <SlideOverPanel.Body
          ref={bodyRef}
          className={isViewMode ? "flex flex-col gap-20" : undefined}
          noPaddingBottom={!isViewMode}
          fillHeight={!isViewMode}
          onInputCapture={isViewMode ? undefined : markDirtyFromBody}
          onChangeCapture={isViewMode ? undefined : markDirtyFromBody}
        >
          {isViewMode ? (
            <>
              {viewModeNotice}
              {sections && (
                <EntitySideSheetSections
                  sections={sections}
                  numbered={numberedSections}
                />
              )}
              {viewModeChildren}
            </>
          ) : (
            <SideSheetActionsContext.Provider value={sheetActions}>
              <SubmitBlockContext.Provider value={editBlock}>
                {mode === "edit" && editNotice ? (
                  <div className="flex flex-col gap-12 pb-20">{editNotice}</div>
                ) : null}
                {/* Always mounted, so turning read-only never remounts the form. */}
                <fieldset disabled={!!editBlock?.readOnly} className="contents" data-submit-block-fieldset>{children}</fieldset>
              </SubmitBlockContext.Provider>
            </SideSheetActionsContext.Provider>
          )}
        </SlideOverPanel.Body>

        {/* A read-only edit form hides its own actions; the way back stays. */}
        {mode === "edit" && editBlock?.readOnly && (
          <SlideOverPanel.Footer className="justify-stretch">
            <Button variant="default" className="flex-1" onClick={backToView}>
              Back to view
            </Button>
          </SlideOverPanel.Footer>
        )}

        {/* Footer — only in view mode */}
        {isViewMode && (
          <SlideOverPanel.Footer className="justify-stretch">
            {canEdit && (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => onModeChange("edit")}
              >
                {editLabel}
              </Button>
            )}
            <SlideOverPanel.Close>
              <Button variant="default" className="flex-1">
                Close
              </Button>
            </SlideOverPanel.Close>
          </SlideOverPanel.Footer>
        )}

        {/* Unsaved-changes guard: Escape, backdrop, close icon, Cancel and the
            back arrow all funnel here instead of discarding typed work. */}
        <DiscardChangesDialog
          isOpen={pendingDiscard !== null}
          onClose={() => setPendingDiscard(null)}
          onDiscard={() => {
            const action = pendingDiscard;
            setPendingDiscard(null);
            if (action) confirmDiscard(action);
          }}
        />
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
    </FormDetailProvider>
  );
}
EntitySideSheet.displayName = "EntitySideSheet";

function EntitySideSheetSections({
  sections,
  numbered = false,
}: {
  sections: DetailPanelSection[];
  numbered?: boolean;
}) {
  return <DetailSpine sections={sections} numbered={numbered} />;
}

/* -------------------------------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------------------------*/

export { EntitySideSheet, EntitySideSheetSections };
export type { EntitySideSheetProps, SideSheetMode };
