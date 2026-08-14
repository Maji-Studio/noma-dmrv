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
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  DetailSpine,
  type DetailPanelSection,
} from "@/components/ui/detail-panel";
import { SideSheetActionsContext } from "./side-sheet-context";

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
  open,
  onOpenChange,
  onCloseAttempt,
  mode,
  onModeChange,
  title,
  subtitle,
  sections,
  numberedSections = false,
  viewModeChildren,
  editLabel = "Edit",
  canEdit = true,
  children,
  size = "wide",
}: EntitySideSheetProps) {
  const isViewMode = mode === "view";

  const bodyRef = React.useRef<HTMLDivElement>(null);
  // Dirty heuristic: any native input/change event inside the body while in
  // edit/create mode. Programmatic setValue from custom widgets is not seen,
  // so the guard can under-trigger there, but it never blocks a clean close.
  const dirtyRef = React.useRef(false);
  // A close/back attempt that hit unsaved changes and awaits confirmation.
  const [pendingDiscard, setPendingDiscard] = React.useState<
    "close" | "view" | null
  >(null);
  const discardTitleId = React.useId();

  // Imperative scrollport work (sanctioned useEffect): the body element
  // persists across view -> edit, so without a reset the edit form inherits
  // the read view's scroll offset and opens mid-record. Also moves focus to
  // the first field so keyboard entry starts at the top of the form.
  React.useEffect(() => {
    dirtyRef.current = false;
    setPendingDiscard(null);
    if (!open) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = 0;
    if (mode === "view") return;
    const frame = requestAnimationFrame(() => {
      const firstField = body.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
      );
      firstField?.focus({ preventScroll: true });
      body.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, mode]);

  function confirmDiscard(action: "close" | "view") {
    if (action === "close") onOpenChange(false);
    else onModeChange("view");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isViewMode) {
      if (onCloseAttempt && !onCloseAttempt()) return;
      if (dirtyRef.current) {
        setPendingDiscard("close");
        return;
      }
    }
    onOpenChange(nextOpen);
  }

  function backToView() {
    if (dirtyRef.current) {
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
  };

  return (
    <SlideOverPanel.Root open={open} onOpenChange={handleOpenChange}>
      <SlideOverPanel.Content size={size}>
        {/* Header */}
        <SlideOverPanel.Header showClose>
          <div className="flex items-center gap-12">
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
              <SlideOverPanel.Title>{title}</SlideOverPanel.Title>
              {subtitle && (
                <SlideOverPanel.Description>
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
          onInputCapture={
            isViewMode ? undefined : () => (dirtyRef.current = true)
          }
          onChangeCapture={
            isViewMode ? undefined : () => (dirtyRef.current = true)
          }
        >
          {isViewMode ? (
            <>
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
              {children}
            </SideSheetActionsContext.Provider>
          )}
        </SlideOverPanel.Body>

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
        <Modal
          isOpen={pendingDiscard !== null}
          onClose={() => setPendingDiscard(null)}
          ariaLabelledBy={discardTitleId}
          width="sm"
        >
          <div className="flex flex-col gap-16">
            <h2 id={discardTitleId} className="title-heading-4">
              Discard unsaved changes?
            </h2>
            <p className="body-small text-[var(--color-text-secondary)]">
              This form has changes that are not saved.
            </p>
            <div className="flex items-center justify-start gap-16">
              <Button
                variant="destructive"
                onClick={() => {
                  const action = pendingDiscard;
                  setPendingDiscard(null);
                  if (action) confirmDiscard(action);
                }}
              >
                Discard changes
              </Button>
              <Button variant="default" onClick={() => setPendingDiscard(null)}>
                Keep editing
              </Button>
            </div>
          </div>
        </Modal>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
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
