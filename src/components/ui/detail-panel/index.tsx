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


import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  isMissingValueCopy,
  MISSING_VALUE,
  type MissingValueSituation,
} from "@/lib/copy-utils";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/forms/section-label";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import {
  isCertFieldValuePresent,
  resolveCertFieldStatus,
} from "@/components/forms/cert-field-status";
import {
  createSpineMeta,
  SpineSectionStatic,
  type SpineMeta,
} from "@/components/forms/form-spine";

/**
 * The situation a detail field assumes when nobody says otherwise: a read
 * sheet mirrors a form, and a blank form field is an operator omission.
 * Fields that mean something else pass `emptySituation` (see the
 * missing-value rule in `@/lib/copy-utils`).
 */
const DEFAULT_EMPTY_SITUATION: MissingValueSituation = "notRecorded";

/**
 * The one placeholder treatment. A placeholder keeps the value slot's size and
 * position so the sheet does not reflow, and drops to tertiary ink at regular
 * weight so it reads quieter than data without going illegible. The weight step
 * is deliberate: colour alone must not carry the distinction (WCAG 1.4.1), and
 * the token's own words stay the primary signal.
 */
const EMPTY_DETAIL_VALUE_CLASS = "font-normal text-[var(--color-text-tertiary)]";
const PRESENT_DETAIL_VALUE_CLASS =
  "font-medium text-[var(--color-text-primary)]";

/**
 * The one pending treatment. It matches the value line's height so the row
 * keeps its size while the value loads.
 */
const PENDING_DETAIL_VALUE_CLASS = "inline-block h-16 w-96 align-middle";

/**
 * The loading stand-in for a detail value.
 *
 * A value still being fetched is not an absent value: a missing-value token
 * would claim the operator left the field blank before the app has looked.
 * Fields whose value arrives from a separate query render this instead.
 */
function DetailValueSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn(PENDING_DETAIL_VALUE_CLASS, className)} />;
}
DetailValueSkeleton.displayName = "DetailValueSkeleton";

/* -------------------------------------------------------------------------------------------------
 * DetailSection - Flat section with a section label, mirrors FormSection so the
 * view ↔ edit mode toggle reads as the same surface (hairline divider above
 * every section but the first).
 * -----------------------------------------------------------------------------------------------*/

interface DetailSectionProps {
  title: string;
  children: React.ReactNode;
  /** Hairline divider above the section (default) — first section disables it. */
  divider?: boolean;
  className?: string;
  /** Positional metadata for the passive read-only step rail. */
  spine?: SpineMeta;
}

function DetailSection({
  title,
  children,
  divider = true,
  className,
  spine,
}: DetailSectionProps) {
  const label = <SectionLabel>{title}</SectionLabel>;

  if (spine) {
    return (
      <SpineSectionStatic meta={spine} label={label} className={className}>
        {children}
      </SpineSectionStatic>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-16",
        divider && "border-t border-[var(--color-border-tertiary)] pt-16",
        className
      )}
    >
      {label}
      {children}
    </div>
  );
}
DetailSection.displayName = "DetailSection";

/* -------------------------------------------------------------------------------------------------
 * DetailRow - Field row: stacks to one column on phones, two columns at `sm`+
 * -----------------------------------------------------------------------------------------------*/

interface DetailRowProps {
  children: React.ReactNode;
  className?: string;
}

function DetailRow({ children, className }: DetailRowProps) {
  // Below `sm` the paired fields stack so long values (codes, names, "Method A
  // (Every Batch)") get the full sheet width instead of a ~170px half-column
  // that wraps. At `sm`+ they sit side-by-side as before — desktop unchanged.
  return (
    <div className={cn("flex flex-col gap-16 sm:flex-row", className)}>
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
  /** Override the value-derived saved status for composite requirements. */
  certifyStatus?: CertFieldStatus;
  /**
   * Which missing-value token stands in when `value` is empty. Defaults to
   * `notRecorded`. Pass the situation rather than passing a placeholder string
   * as `value` — the field then styles the placeholder and reports the field as
   * absent to certification in one step.
   */
  emptySituation?: MissingValueSituation;
  /**
   * Explicit presence signal for the CERT chip, for values the field cannot
   * read (an element, a composed node, an async lookup). `true`/`false` decide
   * the chip outright; omit it to derive presence from `value`.
   */
  valuePresent?: boolean;
  /**
   * The value is still loading. Loading is not absence: the field shows the
   * skeleton instead of a missing-value token, and its CERT chip stays neutral
   * until the query settles.
   */
  pending?: boolean;
}

/**
 * Resolve what a detail field shows and whether it counts as provided.
 *
 * Presence is taken from the raw `value` and the caller's explicit
 * `valuePresent`, never from the string the field ends up rendering. The
 * `isMissingValueCopy` term is a transitional backstop for screens that still
 * pass a rendered token as `value`; it catches the shared vocabulary only, so a
 * screen inventing its own placeholder ("Unassigned", "No crop type") must pass
 * `emptySituation` or `valuePresent={false}` instead of relying on it.
 */
function resolveDetailFieldValue({
  value,
  emptySituation = DEFAULT_EMPTY_SITUATION,
  valuePresent,
  pending,
}: Pick<
  DetailFieldProps,
  "value" | "emptySituation" | "valuePresent" | "pending"
>): {
  displayValue: React.ReactNode;
  isEmpty: boolean;
  present: boolean;
  /** The value slot's ink and weight, so surfaces with their own markup match. */
  valueClassName: string;
} {
  const isBlank = value === null || value === undefined || value === "";
  const rendersSharedToken = isMissingValueCopy(value);
  const present =
    valuePresent ??
    (!isBlank && !rendersSharedToken && isCertFieldValuePresent(value));

  // Loading is not absence: a pending field shows the skeleton and claims
  // nothing about the value, so it is neither empty nor provided.
  if (pending) {
    return {
      displayValue: <DetailValueSkeleton />,
      isEmpty: false,
      present,
      valueClassName: PRESENT_DETAIL_VALUE_CLASS,
    };
  }

  const isEmpty = isBlank || rendersSharedToken || valuePresent === false;

  return {
    displayValue: isBlank ? MISSING_VALUE[emptySituation] : value,
    isEmpty,
    present,
    valueClassName: isEmpty
      ? EMPTY_DETAIL_VALUE_CLASS
      : PRESENT_DETAIL_VALUE_CLASS,
  };
}

function DetailField({
  label,
  value,
  className,
  certifyRequired,
  certifyStatus,
  emptySituation,
  valuePresent,
  pending,
}: DetailFieldProps) {
  const { displayValue, isEmpty, present, valueClassName } =
    resolveDetailFieldValue({ value, emptySituation, valuePresent, pending });
  // A pending field makes no claim yet, so its CERT chip stays neutral until
  // the query settles.
  const resolvedCertifyStatus =
    certifyStatus ?? resolveCertFieldStatus(pending ? undefined : true, present);

  return (
    <div className={cn("flex flex-1 flex-col gap-4 min-w-0", className)}>
      <span className="flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
        {label}
        {certifyRequired && <CertificationFieldTag status={resolvedCertifyStatus} />}
      </span>
      <span
        className={cn("body-medium break-words", valueClassName)}
        aria-busy={pending || undefined}
        data-empty={isEmpty || undefined}
        data-pending={pending || undefined}
      >
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
  detailedOnly?: boolean;
  label: string;
  value: React.ReactNode;
  certifyRequired?: boolean;
  certifyStatus?: CertFieldStatus;
  /** Which missing-value token stands in when `value` is empty. Defaults to `notRecorded`. */
  emptySituation?: MissingValueSituation;
  /** Explicit presence signal for the CERT chip when `value` is not readable. */
  valuePresent?: boolean;
  /** The value is still loading, so the field shows a skeleton, not a token. */
  pending?: boolean;
}

export interface DetailPanelSection {
  /** Optional derived section, excluded from Simple and its numbering. */
  detailedOnly?: boolean;
  title: string;
  fields: DetailPanelField[];
  /** Optional extension content that belongs inside this mirrored section. */
  content?: React.ReactNode;
}

interface DetailSpineProps {
  sections: DetailPanelSection[];
  /** Adds the shared numbered orientation rail used by FormSpine. */
  numbered?: boolean;
}

/** Shared section renderer for read-only entity details. */
function DetailSpine({ sections, numbered = false }: DetailSpineProps) {
  const detailLevel = useFormDetailLevel();
  const visibleSections = sections.filter(section => !section.detailedOnly || detailLevel === "detailed");
  return (
    <div className={cn("flex flex-col", !numbered && "gap-20")}>
      {visibleSections.map((section, sectionIdx) => (
        <DetailSection
          key={section.title}
          title={section.title}
          divider={!numbered && sectionIdx > 0}
          spine={
            numbered
              ? createSpineMeta(sectionIdx, visibleSections.length)
              : undefined
          }
        >
          {chunkFields(section.fields.filter(field => !field.detailedOnly || detailLevel === "detailed")).map((row, rowIdx) => (
            <DetailRow key={rowIdx}>
              {row.map((field, fieldIdx) => (
                <DetailField
                  key={`${rowIdx}-${fieldIdx}`}
                  label={field.label}
                  value={field.value}
                  certifyRequired={field.certifyRequired}
                  certifyStatus={field.certifyStatus}
                  emptySituation={field.emptySituation}
                  valuePresent={field.valuePresent}
                  pending={field.pending}
                />
              ))}
            </DetailRow>
          ))}
          {section.content}
        </DetailSection>
      ))}
    </div>
  );
}
DetailSpine.displayName = "DetailSpine";

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

        <SlideOverPanel.Body>
          <DetailSpine sections={sections} />
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

export {
  resolveDetailFieldValue,
  DetailSection,
  DetailRow,
  DetailField,
  DetailValueSkeleton,
  DetailSpine,
  EntityDetailPanel,
};
