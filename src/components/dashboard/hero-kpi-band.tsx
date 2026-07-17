/**
 * HeroKpiBand — the Flow Hero's 4-stat band: one bordered strip divided into
 * equal cells (mono micro label over a bold value), per the hero design.
 * "—" means no data in range, never a fabricated zero; the delta vs the
 * previous equal period rides along as a quiet mono suffix.
 */
"use client";

import type { DashboardKpi } from "@/data-access/dashboard-overview";

function formatValue(kpi: DashboardKpi): string {
  if (kpi.value == null) return "—";
  const digits = Math.abs(kpi.value) >= 100 ? 0 : 1;
  return kpi.value.toLocaleString(undefined, {
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

export function HeroKpiBand({ kpis, isLoading }: HeroKpiBandProps) {
  const cells = kpis ?? [];

  if (isLoading || cells.length === 0) {
    return (
      <div className="grid grid-cols-2 border-[1.5px] border-[var(--ink)] bg-[var(--paper)] lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className={[
              "px-18 py-14",
              index % 2 === 0 ? "border-r-[1.5px] border-[var(--ink)]" : "",
              index < 2 ? "border-b-[1.5px] border-[var(--ink)] lg:border-b-0" : "",
              index === 1 ? "lg:border-r-[1.5px]" : "",
              index === 2 ? "lg:border-r-[1.5px]" : "",
            ].join(" ")}
          >
            <div className="h-12 w-96 animate-pulse bg-[var(--clr-dark-purple-10)]" />
            <div className="mt-8 h-26 w-64 animate-pulse bg-[var(--clr-dark-purple-10)]" />
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
        <div
          key={kpi.key}
          className={[
            "px-18 py-14",
            index % 2 === 0 ? "border-r-[1.5px] border-[var(--ink)]" : "",
            index < 2 ? "border-b-[1.5px] border-[var(--ink)] lg:border-b-0" : "",
            index === 1 || index === 2 ? "lg:border-r-[1.5px] lg:border-[var(--ink)]" : "",
          ].join(" ")}
        >
          <p className="font-[family-name:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[var(--clr-dark-purple-60)]">
            {kpi.label}
          </p>
          <p className="mt-4 text-[26px] font-bold leading-[1.2]">
            {formatValue(kpi)}{" "}
            <span className="font-[family-name:var(--font-mono)] text-[11px] font-medium text-[var(--clr-dark-purple-60)]">
              {kpi.value != null ? kpi.unit : ""}
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
          </p>
          <p className="body-caption mt-2 text-[var(--color-text-tertiary)]">
            {kpi.detail}
          </p>
        </div>
      ))}
    </div>
  );
}
