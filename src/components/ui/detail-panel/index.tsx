/**
 * Detail Panel Components
 *
 * Reusable read-only detail display components for entity detail slide-overs.
 * Includes both low-level building blocks (DetailSection, DetailRow, DetailField)
 * and a high-level generic EntityDetailPanel that renders from a sections config.
 *
 * @example
 * ```tsx
 * <EntityDetailPanel
 *   open={!!viewing}
 *   onOpenChange={(open) => !open && setViewing(null)}
 *   title={entity.code}
 *   subtitle="Some description"
 *   sections={[
 *     {
 *       title: "General",
 *       fields: [
 *         { label: "Name", value: entity.name },
 *         { label: "Status", value: <StatusBadge status="complete" /> },
 *       ],
 *     },
 *   ]}
 *   onEdit={() => startEditing(entity)}
 *   editLabel="Edit Entity"
 * />
 * ```
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/forms/section-label";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";

/* -------------------------------------------------------------------------------------------------
 * DetailSection - Flat section with mono label, mirrors FormSection so the
 * view ↔ edit mode toggle reads as the same surface (hairline divider above
 * every section but the first).
 * -----------------------------------------------------------------------------------------------*/

interface DetailSectionProps {
  title: string;
  children: React.ReactNode;
  /** Hairline divider above the section (default) — first section disables it. */
  divider?: boolean;
  className?: string;
}

function DetailSection({ title, children, divider = true, className }: DetailSectionProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-16",
        divider && "border-t border-[var(--color-border-tertiary)] pt-16",
        className
      )}
    >
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}
DetailSection.displayName = "DetailSection";

/* -------------------------------------------------------------------------------------------------
 * DetailRow - Two-column row for fields
 * -----------------------------------------------------------------------------------------------*/

interface DetailRowProps {
  children: React.ReactNode;
  className?: string;
}

function DetailRow({ children, className }: DetailRowProps) {
  return (
    <div className={cn("flex gap-16", className)}>
      {children}
    </div>
  );
}
DetailRow.displayName = "DetailRow";

/* -------------------------------------------------------------------------------------------------
 * DetailField - Label + value pair
 * -----------------------------------------------------------------------------------------------*/

interface DetailFieldProps {
  label: string;
  value: React.ReactNode;
  className?: string;
  certifyRequired?: boolean;
}

function DetailField({ label, value, className, certifyRequired }: DetailFieldProps) {
  const displayValue = value === null || value === undefined || value === "" ? "—" : value;

  return (
    <div className={cn("flex flex-1 flex-col gap-4 min-w-0", className)}>
      <span className="flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
        {label}
        {certifyRequired && <CertificationFieldTag />}
      </span>
      <span className="body-medium font-medium text-[var(--color-text-primary)]">
        {displayValue}
      </span>
    </div>
  );
}
DetailField.displayName = "DetailField";

/* -------------------------------------------------------------------------------------------------
 * EntityDetailPanel - Generic slide-over detail panel rendered from config
 * -----------------------------------------------------------------------------------------------*/

export interface DetailPanelField {
  label: string;
  value: React.ReactNode;
  certifyRequired?: boolean;
}

export interface DetailPanelSection {
  title: string;
  fields: DetailPanelField[];
}

interface EntityDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  sections: DetailPanelSection[];
  onEdit?: () => void;
  editLabel?: string;
}

function EntityDetailPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  sections,
  onEdit,
  editLabel = "Edit",
}: EntityDetailPanelProps) {
  return (
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content>
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>{title}</SlideOverPanel.Title>
          {subtitle && (
            <SlideOverPanel.Description>{subtitle}</SlideOverPanel.Description>
          )}
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-20">
          {sections.map((section, sectionIdx) => (
            <DetailSection
              key={section.title}
              title={section.title}
              divider={sectionIdx > 0}
            >
              {/* Render fields in rows of 2 */}
              {chunkFields(section.fields).map((row, rowIdx) => (
                <DetailRow key={rowIdx}>
                  {row.map((field, fieldIdx) => (
                    <DetailField
                      key={`${rowIdx}-${fieldIdx}`}
                      label={field.label}
                      value={field.value}
                      certifyRequired={field.certifyRequired}
                    />
                  ))}
                </DetailRow>
              ))}
            </DetailSection>
          ))}
        </SlideOverPanel.Body>

        {onEdit && (
          <SlideOverPanel.Footer className="justify-stretch">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                onOpenChange(false);
                onEdit();
              }}
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
EntityDetailPanel.displayName = "EntityDetailPanel";

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

/** Chunk an array of fields into rows of 2 */
function chunkFields(fields: DetailPanelField[]): DetailPanelField[][] {
  const rows: DetailPanelField[][] = [];
  for (let i = 0; i < fields.length; i += 2) {
    rows.push(fields.slice(i, i + 2));
  }
  return rows;
}

/* -------------------------------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------------------------*/

export { DetailSection, DetailRow, DetailField, EntityDetailPanel };
