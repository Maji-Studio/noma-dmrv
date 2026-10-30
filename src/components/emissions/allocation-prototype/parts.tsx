/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Small pieces
 * the variants share: owner colours, the group heading with its (i), and the
 * record label. Each variant owns its own layout.
 */
"use client";

import type { ReactNode } from "react";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { batchAccentFill } from "@/components/ui/segment-bar/segment-bar";
import { HATCH_BACKGROUND } from "@/components/chain-of-custody/sankey/waterfall-parts";
import { cn } from "@/lib/utils";
import { GROUPS, type GroupKey, type Owner, type Focus, formatDay, type SourceRecord } from "./fixture";

export const PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
export const MUTED = "text-[var(--color-text-secondary)]";
export const FAINT = "text-[var(--color-text-tertiary)]";
export const HATCH = "moisture-water-hatch";

/**
 * The Traceability header's view switch (traceability-header.tsx SEGMENT_*),
 * copied class for class: a hairline group of mono-free 11px buttons, the
 * pressed one filled with ink. Used for Flow | Table and the quantity switch.
 */
const SEGMENT_GROUP_CLASS = "flex items-stretch border-[1.5px] border-[var(--clr-dark-purple-20)]";
const SEGMENT_BUTTON_CLASS =
  "flex cursor-pointer items-center justify-center border-r-[1.5px] border-[var(--clr-dark-purple-20)] px-12 text-[11px] font-medium last:border-r-0";
const SEGMENT_ACTIVE_CLASS = "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]";
const SEGMENT_IDLE_CLASS = "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]";

export function SegmentGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  stretch = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Equal-width segments across the full width (the quantity switch on a phone). */
  stretch?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn(SEGMENT_GROUP_CLASS, "h-40", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(SEGMENT_BUTTON_CLASS, stretch && "min-w-0 flex-1", value === option.value ? SEGMENT_ACTIVE_CLASS : SEGMENT_IDLE_CLASS)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The same colour for the same credit batch (or Removal) in every variant. */
export function ownerFill(owner: Owner, owners: Owner[]): string | undefined {
  if (owner.notYet) return undefined;
  return batchAccentFill(Math.max(0, owners.findIndex((candidate) => candidate.key === owner.key)));
}

export function groupMeta(group: GroupKey) {
  const meta = GROUPS.find((candidate) => candidate.key === group);
  if (!meta) throw new Error(group);
  return meta;
}

/** "Feedstock transport" with its one (i): the rule that splits it. */
export function GroupTitle({ group, as: Tag = "h3", className, children }: { group: GroupKey; as?: "h2" | "h3"; className?: string; children?: ReactNode }) {
  const meta = groupMeta(group);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-6", className)}>
      <Tag className="body-medium font-medium">{meta.title}</Tag>
      <ExplanationInfo title={meta.title} hint={meta.rule}>
        {children}
      </ExplanationInfo>
    </span>
  );
}

/** Code on top, date and the record's own figures beneath. */
export function RecordLabel({ record, className }: { record: SourceRecord; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="truncate body-small font-medium underline-offset-2 hover:underline">{record.code}</span>
      <span className={cn("truncate body-caption", MUTED)}>
        {formatDay(record.date)}, {record.detail}
      </span>
    </span>
  );
}

/** One word for what the page is about: "this credit batch" or "this Removal". */
export function focusNoun(focus: Focus): string {
  return focus.surface === "batch" ? "This credit batch" : "This Removal";
}

/** Small square swatch in an owner's colour (hatched when not yet allocated). */
export function Swatch({ owner, owners, className }: { owner: Owner; owners: Owner[]; className?: string }) {
  const fill = ownerFill(owner, owners);
  return (
    <span
      aria-hidden
      className={cn("inline-block size-10 shrink-0 border border-[var(--clr-dark-purple-40)]", className)}
      style={fill ? { background: fill } : HATCH_BACKGROUND}
    />
  );
}
