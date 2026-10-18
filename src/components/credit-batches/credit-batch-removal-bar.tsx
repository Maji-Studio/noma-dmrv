"use client";

/**
 * The Removals bar of the credit batch page: applied dry biochar split by the
 * Removal that holds it, then the part in none (epic #1136). The Overview
 * draws it compact, with a hover card per Removal that links to it; the
 * Removals tab draws it in detail, each Removal split into its applications,
 * and clicks through instead of hovering.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { certificationRemovalsHref } from "@/lib/certification/links";
import {
  notAppliedCaptionKg,
  type RemovalBarGroup,
  type RemovalBarRemoval,
  type RemovalBarSegment,
  type RemovalBarSlice,
} from "@/lib/credit-batches/removal-bar";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { FOCUS_RING, MUTED_TEXT } from "./credit-batch-page-parts";

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 120;
const CARD_OFFSET_PX = 8;
const MIN_GROUP_PX = 6;
const MIN_PART_PX = 2;

/**
 * Chart fills, settled with Kenji in the prototype: submitted strongest, a
 * draft the same hue lighter, the applied biochar still to place in the
 * attention colour. They colour bar segments, not status badges.
 */
const SEGMENT_FILLS: Record<RemovalBarSegment, string> = {
  submitted: "var(--st-run)",
  draft: "color-mix(in srgb, var(--st-run) 40%, var(--paper))",
  notInRemoval: "var(--st-wait)",
};

export const NOT_IN_REMOVAL_LABEL = "Applied, not in a Removal";

export function tonnesFromKg(kg: number): string {
  return formatTonnes(kgToTonnes(kg));
}

export function removalHref(facilityId: string, removalId: string): string {
  return certificationRemovalsHref({ facility: facilityId, removal: removalId });
}

/** "DL-26-031 to Kanyama field", or the delivery code alone. */
export function sliceLabel(slice: RemovalBarSlice): string {
  return slice.destinationLabel ? `${slice.deliveryCode} to ${slice.destinationLabel}` : slice.deliveryCode;
}

export function sliceMeta(slice: RemovalBarSlice): string {
  return `${slice.applicationCode}, applied ${formatDate(slice.applicationDate)}`;
}

export function SegmentSwatch({ segment, className }: { segment: RemovalBarSegment; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-12 shrink-0 border border-[var(--st-off-border)]", className)}
      style={{ backgroundColor: SEGMENT_FILLS[segment] }}
    />
  );
}

export function RemovalStatus({ removal }: { removal: RemovalBarRemoval }) {
  return <StatusBadge status={removal.status.value} label={removal.status.label} size="small" />;
}

function groupName(group: RemovalBarGroup): string {
  return group.removal ? group.removal.code : NOT_IN_REMOVAL_LABEL;
}

function groupAccessibleLabel(group: RemovalBarGroup): string {
  const status = group.removal ? `, ${group.removal.status.label}` : "";
  return `${groupName(group)}${status}, ${tonnesFromKg(group.dryKg)}`;
}

/** An interrupted submission reads as a draft, so only a submitted Removal names its submission date. */
export function removalDateLine(removal: Pick<RemovalBarRemoval, "phase" | "submittedAt" | "createdAt">): string {
  return removal.phase === "submitted" && removal.submittedAt
    ? `Submitted ${formatDate(removal.submittedAt)}`
    : `Created ${formatDate(removal.createdAt)}`;
}

function RemovalCardBody({ group }: { group: RemovalBarGroup }) {
  const removal = group.removal;
  if (!removal) return null;
  return (
    <div className="flex w-[280px] max-w-[calc(100vw-32px)] flex-col gap-10 px-16 py-12">
      <div className="flex items-center justify-between gap-12">
        <span className="body-medium font-medium tabular-nums">{removal.code}</span>
        <RemovalStatus removal={removal} />
      </div>
      <span className={cn("body-small", MUTED_TEXT)}>{removalDateLine(removal)}</span>
      <span className="body-medium tabular-nums">
        {tonnesFromKg(group.dryKg)} <span className={cn("body-small", MUTED_TEXT)}>from this credit batch</span>
      </span>
      {group.parts.length > 0 && (
        <ul className="flex flex-col gap-4 border-t border-[var(--color-border-tertiary)] pt-8">
          {group.parts.map((part) => (
            <li key={part.id} className="flex items-baseline justify-between gap-12 body-caption">
              <span className="min-w-0 truncate">{sliceLabel(part.slice)}</span>
              <span className="shrink-0 tabular-nums">{tonnesFromKg(part.dryKg)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A link to the Removal that opens a facts-only hover card on hover or focus. */
function RemovalHoverLink({ group, href, className, style, children }: { group: RemovalBarGroup; href: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={OPEN_DELAY_MS}
        closeDelay={CLOSE_DELAY_MS}
        render={<Link href={href} aria-label={groupAccessibleLabel(group)} className={cn(FOCUS_RING, className)} style={style} />}
      >
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" sideOffset={CARD_OFFSET_PX} className="z-[var(--z-layer-popover)]">
          <PreviewCard.Popup className="border border-[var(--ink)] bg-[var(--paper)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <RemovalCardBody group={group} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

function compactLabel(group: RemovalBarGroup): string {
  if (!group.removal) return `${tonnesFromKg(group.dryKg)} not in a Removal`;
  const draft = group.removal.phase === "draft" ? " draft" : "";
  return `${group.removal.code}${draft} ${tonnesFromKg(group.dryKg)}`;
}

/** Overview: one slim bar and one wrapping line of key items. Each Removal opens its hover card. */
export function CompactRemovalBar({ groups, facilityId }: { groups: RemovalBarGroup[]; facilityId: string }) {
  return (
    <div className="flex flex-col gap-12">
      <div role="group" aria-label="Applied biochar by Removal" className="flex h-12 gap-2">
        {groups.map((group) => {
          const style = { flexGrow: group.dryKg, flexBasis: 0, minWidth: MIN_GROUP_PX, backgroundColor: SEGMENT_FILLS[group.segment] };
          const className = "h-full border border-[var(--st-off-border)]";
          return group.removal ? (
            <RemovalHoverLink key={group.id} group={group} href={removalHref(facilityId, group.removal.id)} className={cn(className, "hover:opacity-80")} style={style}>
              <span className="sr-only">{groupAccessibleLabel(group)}</span>
            </RemovalHoverLink>
          ) : (
            <span key={group.id} aria-hidden className={className} style={style} />
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-16 gap-y-4 body-small">
        {groups.map((group) => (
          <li key={group.id}>
            {group.removal ? (
              <RemovalHoverLink group={group} href={removalHref(facilityId, group.removal.id)} className="group inline-flex min-h-44 items-center gap-6">
                <SegmentSwatch segment={group.segment} />
                <span className="underline-offset-2 group-hover:underline">{compactLabel(group)}</span>
              </RemovalHoverLink>
            ) : (
              <span className="inline-flex min-h-44 items-center gap-6">
                <SegmentSwatch segment={group.segment} />
                <span>{compactLabel(group)}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Removals tab: each Removal split into its applications, named above the bar, and a key list under it. */
export function DetailedRemovalBar({ groups, facilityId }: { groups: RemovalBarGroup[]; facilityId: string }) {
  const firstOpen = groups.findIndex((group) => group.removal == null);
  // Removal codes sit above their segments; with no Removal there is nothing to name.
  const named = groups.some((group) => group.removal);
  return (
    <div className="flex flex-col gap-12">
      <div className="flex gap-4">
        {groups.map((group) => {
          const href = group.removal ? removalHref(facilityId, group.removal.id) : null;
          return (
            <div key={group.id} className="flex min-w-0 flex-col gap-4" style={{ flexGrow: group.dryKg, flexBasis: 0, minWidth: MIN_GROUP_PX }}>
              {named && (href ? (
                <Link href={href} tabIndex={-1} aria-hidden className="block h-18 truncate body-caption underline-offset-2 hover:underline">
                  {group.removal?.code}
                </Link>
              ) : (
                <span aria-hidden className="block h-18" />
              ))}
              <div className="flex h-24 gap-2" aria-hidden>
                {group.parts.map((part) => {
                  const style = { flexGrow: part.dryKg, flexBasis: 0, minWidth: MIN_PART_PX, backgroundColor: SEGMENT_FILLS[group.segment] };
                  const className = "h-full border border-[var(--st-off-border)]";
                  return href ? (
                    <Link key={part.id} href={href} tabIndex={-1} title={`${sliceLabel(part.slice)}, ${tonnesFromKg(part.dryKg)}`} className={cn(className, "hover:opacity-80")} style={style} />
                  ) : (
                    <span key={part.id} title={`${sliceLabel(part.slice)}, ${tonnesFromKg(part.dryKg)}`} className={className} style={style} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="flex flex-col" aria-label="Applied biochar by Removal">
        {groups.map((group, index) => {
          const row = (
            <>
              <SegmentSwatch segment={group.segment} />
              {group.removal ? (
                <span className="inline-flex min-w-0 flex-wrap items-center gap-8">
                  <span className="body-small font-medium underline-offset-2 group-hover:underline">{group.removal.code}</span>
                  <RemovalStatus removal={group.removal} />
                </span>
              ) : (
                <span className="body-small font-medium">{NOT_IN_REMOVAL_LABEL}</span>
              )}
              <span className="body-medium tabular-nums">{tonnesFromKg(group.dryKg)}</span>
            </>
          );
          const rowClass = "grid min-h-44 w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-12 py-8 text-left";
          return (
            <li key={group.id} className={cn(index === firstOpen && index > 0 && "mt-4 border-t border-[var(--color-border-secondary)] pt-4")}>
              {group.removal ? (
                <Link href={removalHref(facilityId, group.removal.id)} className={cn(rowClass, "group hover:bg-[var(--color-surface-medium)]", FOCUS_RING)}>
                  {row}
                </Link>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "0.42 t produced but not applied yet", under the bar; nothing below the visible threshold. */
export function NotAppliedCaption({ model }: { model: CreditBatchPageModel }) {
  const kg = notAppliedCaptionKg(model);
  if (kg == null) return null;
  return <p className={cn("body-small", MUTED_TEXT)}>{tonnesFromKg(kg)} produced but not applied yet</p>;
}
