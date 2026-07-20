/**
 * RangeToggle — the dashboard's period segmented control (Week / Month / All),
 * the inspiration mock's `.seg` recipe: joined mono uppercase buttons inside
 * one plum-20 hairline, active segment inverted to ink. Drives both the KPI
 * band and the hero's mass-flow chips.
 */
"use client";

import type { DashboardRange } from "@/data-access/dashboard-overview";

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
];

interface RangeToggleProps {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
}

export function RangeToggle({ value, onChange }: RangeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Dashboard period"
      className="flex border-[1.5px] border-[var(--clr-dark-purple-20)]"
    >
      {RANGE_OPTIONS.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={[
              "label-micro h-36 px-16 transition-colors",
              index < RANGE_OPTIONS.length - 1
                ? "border-r-[1.5px] border-[var(--clr-dark-purple-20)]"
                : "",
              isActive
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
