/** Small pieces the Flow and Table views share: the view switch, group titles, record labels, swatches. */
"use client";

import { HATCH_BACKGROUND } from "@/components/chain-of-custody/sankey/waterfall-parts";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { cn } from "@/lib/utils";
import type { AllocationRecord, GroupKey } from "@/types/emission-allocation";
import { GROUP_COPY } from "./allocation-copy";
import { recordLine, recordName } from "./allocation-format";
import type { Owner } from "./allocation-model";

export const PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
export const MUTED = "text-[var(--color-text-secondary)]";
export const FAINT = "text-[var(--color-text-tertiary)]";

/**
 * The Traceability header's view switch (traceability-header.tsx SEGMENT_*),
 * class for class: a hairline group of 11px buttons, the pressed one filled
 * with ink. Used for Flow | Table and for the quantity switch.
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

/** "Feedstock transport" with its one (i): the rule that splits it. */
export function GroupTitle({ group }: { group: GroupKey }) {
  const copy = GROUP_COPY[group];
  return (
    <span className="inline-flex min-w-0 items-center gap-6">
      <h3 className="body-medium font-medium">{copy.title}</h3>
      <ExplanationInfo title={copy.title} hint={copy.rule} />
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
