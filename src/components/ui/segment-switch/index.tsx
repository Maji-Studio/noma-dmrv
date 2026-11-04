/**
 * SegmentSwitch: the hairline group of small buttons the Traceability header
 * and the Allocation section use for view and unit switches, the pressed one
 * filled with ink. Below `sm` every button reaches the 44px touch target and
 * the group grows around its borders; from `sm` the group is 40px tall.
 */
"use client";

import { cn } from "@/lib/utils";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";

const SEGMENT_GROUP_CLASS = "flex items-stretch border-[1.5px] border-[var(--clr-dark-purple-20)] h-40 max-sm:h-auto";
const SEGMENT_BUTTON_CLASS =
  "flex cursor-pointer items-center justify-center border-r-[1.5px] border-[var(--clr-dark-purple-20)] px-12 text-[11px] font-medium last:border-r-0";
const SEGMENT_ACTIVE_CLASS = "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]";
const SEGMENT_IDLE_CLASS = "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]";

export function SegmentSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  stretch = false,
  testId,
}: {
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Equal-width segments across the full width (a switch on a phone). */
  stretch?: boolean;
  testId?: string;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className={cn(SEGMENT_GROUP_CLASS, className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(SEGMENT_BUTTON_CLASS, PHONE_TOUCH_TARGET, stretch && "min-w-0 flex-1", value === option.value ? SEGMENT_ACTIVE_CLASS : SEGMENT_IDLE_CLASS)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
