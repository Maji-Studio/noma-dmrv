"use client";

/**
 * PROTOTYPE (throwaway): the stacked mass bar shared by the Overview and the Removals tab.
 * One group per Removal (coloured by its status, split into its applications), then the two
 * open parts: applied but not in a Removal, and not applied yet.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { certificationRemovalsHref } from "@/lib/certification/links";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import { useProto } from "./prototype-context";
import type { MassSegmentKey, RemovalRef } from "./prototype-model";
import { RemovalChip, tonnes } from "./prototype-parts";

/** ?bar= a: spans produced mass; b: spans applied mass; c: like a, with a produced headline number. */
export const BAR_OPTIONS = ["a", "b", "c"] as const;

export function useBarOption() {
  const [bar] = useQueryState("bar", parseAsStringLiteral(BAR_OPTIONS).withDefault("b"));
  return bar;
}

/** The total beside the bar's title, named for what the bar spans. */
export function useBarTotal(): string {
  const { model } = useProto();
  const bar = useBarOption();
  return bar === "b" ? `${tonnes(model.appliedTons)} applied` : `${tonnes(model.appliedTons + model.masses.notApplied)} produced`;
}

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 120;
const SIDE_OFFSET_PX = 8;
const FOCUS_RING = "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]";

/**
 * PROTOTYPE: the stub Removals (R-07, R-08, R-09) have no ids, so they link to the
 * Removals list for this facility. The real build links `/certification/removals/<id>`.
 */
function useRemovalHref(): string {
  const { batch } = useProto();
  return certificationRemovalsHref({ facility: batch.facilityId });
}

function groupLabel(group: { name: string; removal: RemovalRef | null; tons: number }): string {
  const status = group.removal ? (group.removal.status === "draft" ? "Draft" : "Submitted") : "";
  return [group.name, status, tonnes(group.tons)].filter(Boolean).join(", ");
}

const MUTED = "text-[var(--color-text-secondary)]";
const HATCH = "repeating-linear-gradient(135deg, var(--st-off-border) 0 2px, transparent 2px 6px)";
const MIN_SEGMENT_PX = 6;

/** Quiet meaning colours: submitted strongest, draft the same hue lighter, attention for the actionable part, grey for the rest. */
export const SEGMENTS: { key: MassSegmentKey; label: string; fill: string; background?: string }[] = [
  { key: "sent", label: "In submitted Removals", fill: "var(--st-run)" },
  { key: "inRemoval", label: "In draft Removals", fill: "color-mix(in srgb, var(--st-run) 40%, var(--paper))" },
  { key: "notIn", label: "Applied, not in a Removal", fill: "var(--st-wait)" },
  { key: "notApplied", label: "Not applied yet", fill: "var(--st-off-bg)", background: HATCH },
];
export const SEGMENT_BY_KEY = Object.fromEntries(SEGMENTS.map((segment, index) => [segment.key, { ...segment, order: index }])) as Record<
  MassSegmentKey,
  (typeof SEGMENTS)[number] & { order: number }
>;

export function segmentOfRemoval(removal: { status: string } | null): MassSegmentKey {
  if (!removal) return "notIn";
  return removal.status === "draft" ? "inRemoval" : "sent";
}

export function Swatch({ segment, className }: { segment: MassSegmentKey; className?: string }) {
  const { fill, background } = SEGMENT_BY_KEY[segment];
  return <span aria-hidden className={cn("inline-block size-12 shrink-0 border border-[var(--st-off-border)]", className)} style={{ backgroundColor: fill, backgroundImage: background }} />;
}

interface Part { id: string; label: string; tons: number }
interface Group {
  id: string;
  segment: MassSegmentKey;
  /** Short name on the bar and in the legend. */
  name: string;
  removal: RemovalRef | null;
  tons: number;
  parts: Part[];
}

function useGroups(): Group[] {
  const { model } = useProto();
  const bar = useBarOption();
  const groups: Group[] = [];
  for (const removal of model.removals) {
    const slices = model.slices.filter((slice) => slice.removal?.code === removal.code);
    groups.push({
      id: removal.code,
      segment: segmentOfRemoval(removal),
      name: removal.code,
      removal,
      tons: slices.reduce((sum, slice) => sum + slice.tons, 0),
      parts: slices.map((slice) => ({ id: slice.id, label: slice.label, tons: slice.tons })),
    });
  }
  groups.sort((a, b) => SEGMENT_BY_KEY[a.segment].order - SEGMENT_BY_KEY[b.segment].order);
  const open = model.slices.filter((slice) => !slice.removal);
  if (model.masses.notIn > 0) {
    groups.push({ id: "notIn", segment: "notIn", name: "Not in a Removal", removal: null, tons: model.masses.notIn, parts: open.map((slice) => ({ id: slice.id, label: slice.label, tons: slice.tons })) });
  }
  if (model.masses.notApplied > 0 && bar !== "b") {
    groups.push({ id: "notApplied", segment: "notApplied", name: "Not applied yet", removal: null, tons: model.masses.notApplied, parts: [{ id: "notApplied", label: "Not applied yet", tons: model.masses.notApplied }] });
  }
  return groups;
}

function RemovalCardBody({ group }: { group: Group }) {
  const removal = group.removal;
  if (!removal) return null;
  const date = removal.statusNote.split(". ")[0];
  return (
    <div className="flex w-[280px] flex-col gap-10 px-16 py-12">
      <div className="flex items-center justify-between gap-12">
        <span className="body-medium font-medium tabular-nums">{removal.code}</span>
        <StatusBadge status={removal.status === "submitted" ? "issued" : "draft"} label={removal.status === "submitted" ? "Submitted" : undefined} size="small" />
      </div>
      <span className={cn("body-small", MUTED)}>{date}</span>
      <span className="body-medium tabular-nums">{tonnes(group.tons)} <span className={cn("body-small", MUTED)}>from this credit batch</span></span>
      <ul className="flex flex-col gap-4 border-t border-[var(--color-border-tertiary)] pt-8">
        {group.parts.map((part) => (
          <li key={part.id} className="flex items-baseline justify-between gap-12 body-caption">
            <span className="min-w-0 truncate">{part.label}</span>
            <span className="shrink-0 tabular-nums">{tonnes(part.tons)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A link to the Removal that opens a facts-only hover card on hover or focus. */
function RemovalHoverLink({ group, className, style, children }: { group: Group; className?: string; style?: React.CSSProperties; children: ReactNode }) {
  const href = useRemovalHref();
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} render={<Link href={href} aria-label={groupLabel(group)} className={cn(FOCUS_RING, className)} style={style} />}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" sideOffset={SIDE_OFFSET_PX} className="z-[var(--z-layer-popover)]">
          <PreviewCard.Popup className="border border-[var(--ink)] bg-[var(--paper)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <RemovalCardBody group={group} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

/** Overview version: one slim bar and one wrapping line of inline legend items. Removals open a hover card. */
function CompactBar({ groups }: { groups: Group[] }) {
  return (
    <div className="flex flex-col gap-12">
      <div role="group" aria-label="Biochar by Removal" className="flex h-12 gap-2 bg-[var(--paper)]">
        {groups.map((group) => {
          const seg = SEGMENT_BY_KEY[group.segment];
          const style = { flexGrow: group.tons, flexBasis: 0, minWidth: MIN_SEGMENT_PX, backgroundColor: seg.fill, backgroundImage: seg.background };
          const className = "h-full border border-[var(--st-off-border)]";
          return group.removal ? (
            <RemovalHoverLink key={group.id} group={group} className={cn(className, "hover:opacity-80")} style={style}>
              <span className="sr-only">{groupLabel(group)}</span>
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
              <RemovalHoverLink group={group} className="group inline-flex items-center gap-6">
                <Swatch segment={group.segment} />
                <span className="underline-offset-2 group-hover:underline">{compactLabel(group)}</span>
              </RemovalHoverLink>
            ) : (
              <span className="inline-flex items-center gap-6">
                <Swatch segment={group.segment} />
                <span>{compactLabel(group)}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function compactLabel(group: Group): string {
  if (group.removal) return `${group.name}${group.removal.status === "draft" ? " draft" : ""} ${tonnes(group.tons)}`;
  return `${tonnes(group.tons)} ${group.segment === "notIn" ? "not in a Removal" : "not applied"}`;
}

function NotAppliedCaption() {
  const { model } = useProto();
  const bar = useBarOption();
  if (bar !== "b" || model.masses.notApplied <= 0) return null;
  return <p className={cn("body-small", MUTED)}>{tonnes(model.masses.notApplied)} produced but not applied yet</p>;
}

export function RemovalMassBar(props: { compact?: boolean }) {
  return (
    <div className="flex flex-col gap-12">
      <BarBody {...props} />
      <NotAppliedCaption />
    </div>
  );
}

function BarBody({ compact }: { compact?: boolean }) {
  const groups = useGroups();
  const href = useRemovalHref();
  const [active, setActive] = useState<{ text: string; center: number } | null>(null);
  const total = groups.reduce((sum, group) => sum + group.tons, 0);
  if (groups.length === 0) return null;
  if (compact) return <CompactBar groups={groups} />;
  const firstOpen = groups.findIndex((group) => group.removal == null);
  return (
    <div className="flex flex-col gap-12">
      <div className="relative">
        <div className="flex gap-4">
          {groups.map((group) => {
            const start = groups.slice(0, groups.indexOf(group)).reduce((sum, g) => sum + g.tons, 0);
            const seg = SEGMENT_BY_KEY[group.segment];
            return (
              <div key={group.id} className="flex min-w-0 flex-col gap-4" style={{ flexGrow: group.tons, flexBasis: 0, minWidth: MIN_SEGMENT_PX }}>
                {group.removal ? (
                  <Link href={href} aria-label={groupLabel(group)} className={cn("block h-18 truncate body-caption underline-offset-2 hover:underline", FOCUS_RING)}>
                    {`${group.name} ${tonnes(group.tons)}`}
                  </Link>
                ) : (
                  <span className={cn("block h-18 truncate body-caption", MUTED)} />
                )}
                <div className="flex h-24 gap-2 bg-[var(--paper)]">
                  {group.parts.map((part, index) => {
                    const before = group.parts.slice(0, index).reduce((sum, p) => sum + p.tons, 0);
                    const center = ((start + before + part.tons / 2) / total) * 100;
                    const text = group.removal ? `${group.name}: ${part.label}, ${tonnes(part.tons)}` : `${part.label}, ${tonnes(part.tons)}`;
                    const handlers = {
                      onMouseEnter: () => setActive({ text, center }),
                      onMouseLeave: () => setActive(null),
                      onFocus: () => setActive({ text, center }),
                      onBlur: () => setActive(null),
                    };
                    const style = { flexGrow: part.tons, flexBasis: 0, minWidth: 2, backgroundColor: seg.fill, backgroundImage: seg.background };
                    const className = "h-full border border-[var(--st-off-border)]";
                    return group.removal ? (
                      <Link key={part.id} href={href} aria-label={`${groupLabel(group)}, ${part.label}`} {...handlers} className={cn(className, "cursor-pointer hover:opacity-80", FOCUS_RING)} style={style} />
                    ) : (
                      <span key={part.id} role="img" tabIndex={0} aria-label={text} {...handlers} className={cn(className, FOCUS_RING)} style={style} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {active && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute top-full z-10 mt-4 max-w-full border border-[var(--color-border-secondary)] bg-[var(--paper)] px-8 py-4 body-caption", active.center > 50 ? "right-0 text-right" : "left-0")}
          >
            {active.text}
          </span>
        )}
      </div>
      <ul className="flex flex-col">
        {groups.map((group, index) => {
          const open = group.removal == null;
          const row = (
            <>
              <Swatch segment={group.segment} />
              {group.removal ? <RemovalChip removal={group.removal} /> : <span className="body-small font-medium">{group.name === "Not in a Removal" ? "Applied, not in a Removal" : group.name}</span>}
              <span className="body-medium tabular-nums">{tonnes(group.tons)}</span>
            </>
          );
          const rowClass = "grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-12 py-8 text-left";
          return (
            <li key={group.id} className={cn(index === firstOpen && index > 0 && "mt-4 border-t border-[var(--color-border-secondary)] pt-4", open && "bg-transparent")}>
              {group.removal ? (
                <Link href={href} aria-label={groupLabel(group)} className={cn(rowClass, "group hover:bg-[var(--color-surface-medium)]", FOCUS_RING)}>{row}</Link>
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
