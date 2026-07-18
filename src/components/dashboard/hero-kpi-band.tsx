/**
 * HeroKpiBand — the Flow Hero's 4-stat band: one bordered strip divided into
 * equal cells (mono micro label over a bold value), per the hero design.
 * "—" means no data in range, never a fabricated zero; the delta vs the
 * previous equal period rides along as a quiet mono suffix.
 *
 * Cells avoid <p>/<h*> elements — the global element type rules are unlayered
 * and would override the band's utility sizing (see globals.css typography).
 */
"use client";

import type { DashboardKpi } from "@/data-access/dashboard-overview";

/** Pinned so server and client format the number identically (no hydration drift). */
const NUMBER_LOCALE = "en-US";

function formatValue(kpi: DashboardKpi): string {
  if (kpi.value == null) return "—";
  const digits = Math.abs(kpi.value) >= 100 ? 0 : 1;
  return kpi.value.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDelta(deltaPercent: number): string {
  const rounded = Math.round(deltaPercent);
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
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
      {cells.map((kpi, index) => (
        <div key={kpi.key} className={`px-20 py-16 ${CELL_BORDERS(index)}`}>
          <div className="font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase leading-[1.2] tracking-[0.1em] text-[var(--clr-dark-purple-60)]">
            {kpi.label}
          </div>
          <div className="mt-6 text-[26px] font-bold leading-[1.15] text-[var(--ink)]">
            {formatValue(kpi)}
            {kpi.value != null && (
              <span className="ml-4 font-[family-name:var(--font-mono)] text-[11px] font-medium text-[var(--clr-dark-purple-60)]">
                {kpi.unit}
                {kpi.deltaPercent != null && (
                  <span
                    className="ml-6"
                    style={{
                      color:
                        Math.round(kpi.deltaPercent) >= 0
                          ? "var(--st-ok)"
                          : "var(--st-wait)",
                    }}
                  >
                    {formatDelta(kpi.deltaPercent)}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="mt-4 font-[family-name:var(--font-mono)] text-[10px] leading-[1.4] tracking-[0.02em] text-[var(--color-text-tertiary)]">
            {kpi.detail}
          </div>
        </div>
      ))}
    </div>
  );
}
