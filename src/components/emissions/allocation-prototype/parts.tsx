/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Small pieces
 * the variants share: owner colours, the group heading with its (i), and the
 * record label. Each variant owns its own layout.
 */
"use client";

import type { ReactNode } from "react";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { batchAccentFill } from "@/components/ui/segment-bar/segment-bar";
import { cn } from "@/lib/utils";
import { GROUPS, type GroupKey, type Owner, type Focus, formatDay, type SourceRecord } from "./fixture";

export const PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
export const MUTED = "text-[var(--color-text-secondary)]";
export const FAINT = "text-[var(--color-text-tertiary)]";
export const HATCH = "moisture-water-hatch";

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
      className={cn("inline-block size-10 shrink-0 border border-[var(--color-border-secondary)]", !fill && HATCH, className)}
      style={fill ? { background: fill } : undefined}
    />
  );
}
