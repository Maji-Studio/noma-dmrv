/**
 * The parts the dashboard sections share, so siblings stay one system: the
 * section chrome, the one row anatomy for To do, Bins and Recent activity, the
 * stage icons and list labels, the quick action shape, and the loading, empty
 * and error states.
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CubeIcon,
  FactoryIcon,
  HandshakeIcon,
  LeafIcon,
  MapPinIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type {
  DashboardActivityItem,
  DashboardAttentionItem,
  DashboardStationKey,
} from "@/data-access/dashboard-overview";
import type { DashboardStructuralGap } from "@/data-access/dashboard-structural-gaps";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { formatFacilityShortDateTime, formatFacilityShortDay } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

export const FOCUS_RING =
  "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]";

export interface QuickAction {
  key: string;
  label: string;
  href: string;
  /** The stage whose list this action records into, when it has one. */
  stage?: DashboardStationKey;
}

// ---------------------------------------------------------------------------
// Stages: the six traceability stations.
// ---------------------------------------------------------------------------

export const STAGE_ICON: Record<DashboardStationKey, Icon> = {
  suppliers: HandshakeIcon,
  feedstock: LeafIcon,
  production: FactoryIcon,
  products: CubeIcon,
  deliveries: TruckIcon,
  applications: MapPinIcon,
};

/** The list each stage opens (sidebar labels). */
export const STAGE_LIST_LABEL: Record<DashboardStationKey, string> = {
  suppliers: "Suppliers",
  feedstock: "Feedstock intake",
  production: "Production runs",
  products: "Biochar products",
  deliveries: "Deliveries",
  applications: "Applications",
};

// ---------------------------------------------------------------------------
// Rows: one anatomy for todos and activity.
// ---------------------------------------------------------------------------

export interface DashRowData {
  id: string;
  title: string;
  /** A quiet line under the title (a bin's kind and what it holds). */
  subtitle?: string;
  /** Code and date, or a grouped row's list and count. */
  meta: string;
  href: string;
}

/** A short day for one-line rows ("Sep 30"; the year only when it is not this year), or null when there is none. */
export function shortDay(value: string | Date | null, timeZone: string, calendarDay = false): string | null {
  return value == null ? null : formatFacilityShortDay(value, timeZone, { calendarDay });
}

export function todoRows(
  attention: DashboardAttentionItem[],
  structuralGaps: DashboardStructuralGap[],
): DashRowData[] {
  return [
    ...structuralGaps.map((gap) => ({
      id: `gap-${gap.key}`,
      title: gap.label,
      meta: gap.metadata,
      href: gap.href,
    })),
    // One line at a third of the page: the title, then only the record's day
    // (a grouped row says how many). The code is on the record it opens.
    ...attention.map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.count == null ? (shortDay(item.date, "UTC", true) ?? "") : `${item.count} affected`,
      href: item.href,
    })),
  ];
}

export function activityRows(
  activity: DashboardActivityItem[],
  timeZone: string,
): DashRowData[] {
  return activity.map((item) => ({
    id: item.id,
    title: item.title,
    // The time sits right of the date. Feedstock intake and applications
    // carry a business date only, so they show the day alone.
    meta: item.calendarDay
      ? (shortDay(item.dateIso, timeZone, true) ?? "")
      : formatFacilityShortDateTime(item.dateIso, timeZone),
    href: item.href,
  }));
}

/**
 * The one row: title left, code and date right (under the title in a narrow list),
 * a trailing arrow or a named action. The whole row is one link.
 */
export function DashRow({ row }: { row: DashRowData }) {
  return (
    <li className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
      <Link
        href={row.href}
        className={cn(
          "group grid min-h-48 grid-cols-[minmax(0,1fr)_auto] items-center gap-12 transition-colors hover:bg-[var(--color-surface-medium)]",
          "px-20 py-12",
          FOCUS_RING,
        )}
      >
        {/* One line when the list is wide enough, title over code and date when
            not; a subtitle runs under both at the row's full width. */}
        <span className="flex min-w-0 flex-col gap-2">
          <span className="flex min-w-0 flex-col gap-2 @min-[18rem]:flex-row @min-[18rem]:items-baseline @min-[18rem]:gap-12">
            <span className="body-small min-w-0 text-[var(--color-text-primary)] @min-[18rem]:flex-1 @min-[18rem]:truncate">
              {row.title}
            </span>
            {row.meta && (
              <span className="body-caption tabular-nums text-[var(--color-text-tertiary)] @min-[18rem]:whitespace-nowrap">
                {row.meta}
              </span>
            )}
          </span>
          {row.subtitle && (
            <span className="body-caption min-w-0 truncate text-[var(--color-text-tertiary)]">{row.subtitle}</span>
          )}
        </span>
        <ArrowRightIcon
          size={14}
          weight="bold"
          className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
          aria-hidden
        />
      </Link>
    </li>
  );
}

export function DashRowList({ rows, label }: { rows: DashRowData[]; label: string }) {
  return (
    <ul className="@container flex flex-col" aria-label={label}>
      {rows.map((row) => (
        <DashRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex min-h-48 items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 first:border-t-0"
        >
          <Skeleton height={14} width="45%" />
          <Skeleton height={12} width={96} />
        </div>
      ))}
    </div>
  );
}

/**
 * Section chrome: the title sits outside, above a plain panel, at the
 * section-title size; no bar, no divider. `action` is a quiet link at the
 * right of the title row. Untitled, the section is named by `label` for
 * assistive tech and carries no title row.
 */
export function DashSection({
  title,
  label,
  action,
  children,
  headingId,
}: {
  title?: string;
  label?: string;
  action?: ReactNode;
  children: ReactNode;
  headingId: string;
}) {
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : label}
      className="flex min-w-0 flex-col gap-12"
    >
      {/* 44px tall whether or not it carries a link, so sibling titles line up. */}
      {title && (
        <div className="flex min-h-44 flex-wrap items-center justify-between gap-x-16 gap-y-4">
          <h2 id={headingId} className="body-lead font-medium text-[var(--color-text-primary)]">
            {title}
          </h2>
          {action}
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col bg-[var(--panel-bg)] [border:var(--panel-border)]">
        {children}
      </div>
    </section>
  );
}

/** A section's title-row link, styled like the stage actions: quiet sentence case with a trailing arrow. */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-44 items-center gap-6 px-6 body-small font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-medium)]",
        FOCUS_RING,
      )}
    >
      {children}
      <ArrowRightIcon size={14} weight="bold" className="text-[var(--color-interaction)]" aria-hidden />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * Nothing to fix in the filter's scope. The filter always applies, so the
 * title names it and never reads as a facility-wide all clear; one batch
 * offers the way back to all. No create action: the stage band carries them.
 */
export function TodoEmpty({ clearFilterHref }: { clearFilterHref: string | null }) {
  return (
    <div className="p-16">
      <EmptyState
        padding="sm"
        icon={<CheckCircleIcon size={32} weight="bold" />}
        title={clearFilterHref ? "Nothing to fix in this credit batch" : "Nothing to fix in credit batches"}
        action={clearFilterHref ? <SectionLink href={clearFilterHref}>Show all credit batches</SectionLink> : undefined}
      />
    </div>
  );
}

/**
 * No activity in the filter's scope. The filter always applies, so the title
 * names it: one batch offers the way back to all, and all credit batches says
 * nothing traceable to a batch has happened yet.
 */
export function ActivityEmpty({ clearFilterHref }: { clearFilterHref: string | null }) {
  return (
    <div className="p-16">
      <EmptyState
        padding="sm"
        icon={<LeafIcon size={32} weight="bold" />}
        title={clearFilterHref ? "No recent activity for this credit batch" : "No credit batch activity yet"}
        action={clearFilterHref ? <SectionLink href={clearFilterHref}>Show all credit batches</SectionLink> : undefined}
      />
    </div>
  );
}

/** The read's own safe message, never a guessed cause. */
export function LoadError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <Notice
      tone="error"
      title="The dashboard could not be loaded."
      action={
        <Button variant="default" size="small" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {message}
    </Notice>
  );
}
