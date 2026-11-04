/**
 * SegmentSwitch: the hairline group of small buttons the Traceability header
 * uses for its view and unit switches, the pressed one filled with ink. The
 * class constants are shared so every switch of this look changes together.
 * `touchTarget` lifts the group to 44px below `sm` for a switch that is used on
 * phones.
 */
"use client";

import { cn } from "@/lib/utils";

export const SEGMENT_GROUP_CLASS = "flex items-stretch border-[1.5px] border-[var(--clr-dark-purple-20)]";
export const SEGMENT_BUTTON_CLASS =
  "flex cursor-pointer items-center justify-center border-r-[1.5px] border-[var(--clr-dark-purple-20)] px-12 text-[11px] font-medium last:border-r-0";
export const SEGMENT_ACTIVE_CLASS = "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]";
export const SEGMENT_IDLE_CLASS = "text-[var(--clr-dark-purple-60)] hover:text-[var(--clr-dark-purple)]";

const SWITCH_HEIGHT_CLASS = "h-40";
const PHONE_TOUCH_HEIGHT_CLASS = "max-sm:h-44";

export function SegmentSwitch<T extends string>({
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
  /** Equal-width segments across the full width (a switch on a phone). */
  stretch?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn(SEGMENT_GROUP_CLASS, SWITCH_HEIGHT_CLASS, PHONE_TOUCH_HEIGHT_CLASS, className)}>
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
