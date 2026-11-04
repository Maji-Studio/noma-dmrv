/** Small pieces the Flow and Table views share: group titles, record labels, swatches. */
"use client";

import { HATCH_BACKGROUND } from "@/components/ui/chart-tokens";
import { SegmentedControl } from "@/components/forms/segmented-control";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { cn } from "@/lib/utils";
import type { AllocationRecord, GroupKey } from "@/types/emission-allocation";
import { GROUP_COPY, groupRule } from "./allocation-copy";
import { recordLine, recordName } from "./allocation-format";
import type { Owner } from "./allocation-model";

export const PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
export const MUTED = "text-[var(--color-text-secondary)]";
export const FAINT = "text-[var(--color-text-tertiary)]";

/** "Feedstock transport" with its one (i): the rule that splits it. */
export function GroupTitle({ group, surface }: { group: GroupKey; surface: "batch" | "removal" }) {
  const copy = GROUP_COPY[group];
  return (
    <span className="inline-flex min-w-0 items-center gap-6">
      <h3 className="body-medium font-medium">{copy.title}</h3>
      <ExplanationInfo title={copy.title} hint={groupRule(group, surface)} />
    </span>
  );
}

/** Name on top, date and the record's own facts beneath. */
export function RecordLabel({ record }: { record: AllocationRecord }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate body-small font-medium">{recordName(record)}</span>
      <span className={cn("truncate body-caption", MUTED)}>{recordLine(record)}</span>
    </span>
  );
}

/** Small square swatch for Not yet allocated, in the chart's hatch. */
export function NotYetSwatch({ owner }: { owner: Owner }) {
  if (!owner.notYet) return null;
  return <span aria-hidden className="inline-block size-10 shrink-0 border border-[var(--clr-dark-purple-40)]" style={HATCH_BACKGROUND} />;
}

/** A short mode switch: the documented SegmentedControl, native radios with arrow keys and a check glyph. */
export function ModeSwitch<T extends string>({ legend, options, value, onChange, className }: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return <SegmentedControl legend={legend} options={options} value={value} onValueChange={(next) => onChange(next as T)} className={className} />;
}
