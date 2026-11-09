/**
 * HeroKpiBand — the dashboard's 4-stat band: one bordered strip divided into
 * equal cells (label over a bold value). A mass value carries its basis in
 * the unit ("2.4 t dry"). A null value means the figure is unknown, never a
 * fabricated zero: the value slot shows a muted bar named "No value" for
 * assistive tech, with no written reason. A real zero reads "0 t dry".
 *
 * Cells avoid <p>/<h*> elements — the global element type rules are unlayered
 * and would override the band's utility sizing (see globals.css typography).
 */
"use client";

import type { DashboardKpi } from "@/data-access/dashboard-overview";
import { InfoHint } from "@/components/ui/tooltip";

/** Pinned so server and client format the number identically (no hydration drift). */
const NUMBER_LOCALE = "en-US";

function formatValue(value: number): string {
  if (value === 0) return "0";
  const digits = Math.abs(value) >= 100 ? 0 : 1;
  return value.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** The mass basis rides in the unit ("2.4 t dry"); CO₂e names its own. */
function unitOf(kpi: DashboardKpi): string {
  return kpi.key === "co2eStored" ? kpi.unit : `${kpi.unit} dry`;
}

/** A muted bar for "no figure", drawn in CSS. It says no reason: an empty bar is clear enough. */
function EmptyFigure() {
  return (
    <span
      role="img"
      aria-label="No value"
      className="inline-block h-4 w-24 bg-[var(--color-text-tertiary)] align-middle"
    />
  );
}

interface HeroKpiBandProps {
  kpis: DashboardKpi[] | undefined;
  isLoading: boolean;
}

const CELL_BORDERS = (index: number): string =>
  [
    index % 2 === 0 ? "border-r-[1.5px] border-[var(--ink)]" : "",
    index < 2 ? "border-b-[1.5px] border-[var(--ink)] lg:border-b-0" : "",
    index === 1 || index === 2 ? "lg:border-r-[1.5px] lg:border-[var(--ink)]" : "",
  ].join(" ");

export function HeroKpiBand({ kpis, isLoading }: HeroKpiBandProps) {
  const cells = kpis ?? [];

  if (isLoading || cells.length === 0) {
    return (
      <div className="grid grid-cols-2 border-[1.5px] border-[var(--ink)] bg-[var(--paper)] lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={`px-20 py-16 ${CELL_BORDERS(index)}`}>
            <div className="h-12 w-96 animate-pulse bg-[var(--clr-dark-purple-10)]" />
            <div className="mt-8 h-28 w-64 animate-pulse bg-[var(--clr-dark-purple-10)]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 border-[1.5px] border-[var(--ink)] bg-[var(--paper)] lg:grid-cols-4"
      data-testid="dashboard-kpis"
    >
      {cells.map((kpi, index) => {
        return (
          <div key={kpi.key} className={`px-20 py-16 ${CELL_BORDERS(index)}`}>
            {/* Top aligned, so the (i) sits level when a label wraps on a phone. */}
            <div className="flex min-h-24 items-start gap-4">
              <span className="body-caption text-[var(--clr-dark-purple-60)]">{kpi.label}</span>
              {kpi.hint && <InfoHint label={`More about ${kpi.label}`}>{kpi.hint}</InfoHint>}
            </div>
            <div className="mt-6 text-[26px] font-bold leading-[1.15] text-[var(--ink)]">
              {kpi.value == null ? <EmptyFigure /> : formatValue(kpi.value)}
              {kpi.value != null && (
                // The type class resets margins, so the gap sits on a wrapper.
                <span className="ml-4">
                  <span className="body-caption font-medium text-[var(--clr-dark-purple-60)]">{unitOf(kpi)}</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
