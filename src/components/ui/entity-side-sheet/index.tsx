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
import {
  DetailSection,
  DetailRow,
  DetailField,
  type DetailPanelSection,
} from "@/components/ui/detail-panel";

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
  /** The form component rendered in edit/create mode */
  children: React.ReactNode;
  /** Panel width */
  size?: "default" | "narrow" | "wide" | "full";
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

/** Chunk an array of fields into rows of 2 */
function chunkFields<T>(fields: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < fields.length; i += 2) {
    rows.push(fields.slice(i, i + 2));
  }
  return rows;
}

/* -------------------------------------------------------------------------------------------------
 * EntitySideSheet
 * -----------------------------------------------------------------------------------------------*/

function EntitySideSheet({
  open,
  onOpenChange,
  mode,
  onModeChange,
  title,
  subtitle,
  sections,
  viewModeChildren,
  editLabel = "Edit",
  children,
  size = "wide",
}: EntitySideSheetProps) {
  const isViewMode = mode === "view";
  const isCreateMode = mode === "create";

  // Determine header title/subtitle based on mode
  const headerTitle = isViewMode ? title : isCreateMode ? title : title;
  const headerSubtitle = isViewMode
    ? subtitle
    : isCreateMode
      ? subtitle
      : subtitle;

  return (
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size={size}>
        {/* Header */}
        <SlideOverPanel.Header showClose>
          <div className="flex items-center gap-12">
            {/* Back arrow: only in edit mode when coming from view (not create) */}
            {mode === "edit" && (
              <Button
                variant="noOutline"
                size="icon"
                onClick={() => onModeChange("view")}
                className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                aria-label="Back to view"
              >
                <ArrowLeftIcon />
              </Button>
            )}
            <div className="flex flex-col gap-4 min-w-0">
              <SlideOverPanel.Title>{headerTitle}</SlideOverPanel.Title>
              {headerSubtitle && (
                <SlideOverPanel.Description>
                  {headerSubtitle}
                </SlideOverPanel.Description>
              )}
            </div>
          </div>
        </SlideOverPanel.Header>

        {/* Body */}
        <SlideOverPanel.Body
          className={isViewMode ? "flex flex-col gap-20" : undefined}
          noPaddingBottom={!isViewMode}
        >
          {isViewMode ? (
            <>
              {sections?.map((section, sectionIdx) => (
                <DetailSection
                  key={section.title}
                  title={section.title}
                  divider={sectionIdx > 0}
                >
                  {chunkFields(section.fields).map((row, rowIdx) => (
                    <DetailRow key={rowIdx}>
                      {row.map((field) => (
                        <DetailField
                          key={field.label}
                          label={field.label}
                          value={field.value}
                          certifyRequired={field.certifyRequired}
                        />
                      ))}
                    </DetailRow>
                  ))}
                </DetailSection>
              ))}
              {viewModeChildren}
            </>
          ) : (
            children
          )}
        </SlideOverPanel.Body>

        {/* Footer — only in view mode */}
        {isViewMode && (
          <SlideOverPanel.Footer className="justify-stretch">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => onModeChange("edit")}
            >
              {editLabel}
            </Button>
            <SlideOverPanel.Close>
              <Button variant="default" className="flex-1">
                Close
              </Button>
            </SlideOverPanel.Close>
          </SlideOverPanel.Footer>
        )}
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
EntitySideSheet.displayName = "EntitySideSheet";

/* -------------------------------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------------------------*/

export { EntitySideSheet };
export type { EntitySideSheetProps, SideSheetMode };
