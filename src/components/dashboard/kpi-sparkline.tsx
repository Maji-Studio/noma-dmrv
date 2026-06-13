/**
 * KpiSparkline — the KPI strip's 12-point trend line (visual design plan,
 * Phase 5). Pure SVG, plum stroke per the inspiration mock; a flat series
 * renders muted so "no movement" never reads as a signal.
 */
"use client";

const VIEW_W = 120;
const VIEW_H = 32;
const PAD = 3;

interface KpiSparklineProps {
  series: number[];
  label: string;
}

export function KpiSparkline({ series, label }: KpiSparklineProps) {
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const spread = max - min || 1;
  const isFlat = series.every((value) => value === series[0]);

  const path = series
    .map((value, index) => {
      const x = PAD + (index * (VIEW_W - 2 * PAD)) / (series.length - 1);
      const y = VIEW_H - PAD - ((value - min) / spread) * (VIEW_H - 2 * PAD);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="h-32 w-full"
      role="img"
      aria-label={label}
    >
      <path
        d={path}
        fill="none"
        stroke={isFlat ? "var(--clr-dark-purple-20)" : "var(--clr-purple)"}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
