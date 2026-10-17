/** PROTOTYPE shared helpers for the monthly report variants. */
import { formatDate } from "@/lib/format-utils";
import type { EnergyFigure } from "./fixture";
import type { ReactNode } from "react";
import { CalendarBlankIcon, BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { FACILITY_NAME, MONTH_LABEL } from "./fixture";

export const fmtKg = (n: number) => `${n.toLocaleString("en-US")} kg`;
export const fmtNum = (n: number) => n.toLocaleString("en-US");
export const fmtPct = (n: number | null) => (n === null ? "Not available" : `${(n * 100).toFixed(1)}%`);
export const fmtDay = (d: string) => formatDate(d);
export const fmtShort = (d: string) => formatDate(d).replace(/, \d{4}$/, "");

export const RULES = [
  "Production runs count in the month they ended. A run that straddles two months counts fully in its end month, and a run that has not ended is not counted.",
  "Feedstock received, biochar deliveries and applications count in the month of their own record date.",
  "Credit batches count in the month their period ends, and are listed once even if they span several months.",
  "Energy is shown per credit batch, summed over every production run inside the batch period. Runs in no credit batch are listed under Unbatched.",
] as const;

export const FLOOR_NOTE =
  "Totals skip missing readings, so they are a floor, not a complete figure.";

export function missingCount(e: EnergyFigure) {
  return e.missingDiesel + e.missingGrid;
}

/** "142 L" or "at least 142 L" when a reading is missing. */
export function energyText(value: number, unit: string, missing: number) {
  return `${missing > 0 ? "At least " : ""}${fmtNum(value)} ${unit}`;
}

export function missingText(e: EnergyFigure) {
  const parts: string[] = [];
  if (e.missingDiesel) parts.push(`${e.missingDiesel} diesel`);
  if (e.missingGrid) parts.push(`${e.missingGrid} grid`);
  return parts.length ? `Missing readings: ${parts.join(", ")}` : "All readings recorded";
}

/* ---------------- shared chrome (panel, controls, empty state) ---------------- */

export const PANEL = "bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)]";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${PANEL} ${className}`}>{children}</div>;
}

/** Static stand-ins for the facility and month pickers. */
export function ReportToolbar() {
  const control =
    "flex h-40 items-center gap-8 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small";
  return (
    <div className="flex flex-wrap gap-12">
      <span className={control}>
        <BuildingsIcon size={16} weight="bold" aria-hidden />
        {FACILITY_NAME}
      </span>
      <span className={control}>
        <CalendarBlankIcon size={16} weight="bold" aria-hidden />
        {MONTH_LABEL}
      </span>
    </div>
  );
}

export function EmptyMonth() {
  return (
    <EmptyState
      icon={<CalendarBlankIcon size={48} weight="bold" />}
      title={`No records for ${MONTH_LABEL}`}
      description={`${FACILITY_NAME} has no production runs, feedstock deliveries, biochar deliveries, applications or credit batches in this month. Pick another month to see its report.`}
    />
  );
}
