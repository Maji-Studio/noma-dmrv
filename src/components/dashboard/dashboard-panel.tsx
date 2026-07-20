/**
 * DashboardPanel — the dashboard's shared panel chrome: the Phase-2.5 panel
 * recipe (paper + plum hairline) with the inspiration mock's head row — mono
 * micro-label title left, quiet meta right, hairline divider below.
 */
import type { ReactNode } from "react";

interface DashboardPanelProps {
  title: string;
  /** Right-aligned head slot — a count, a status chip, a legend. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DashboardPanel({
  title,
  meta,
  children,
  className,
}: DashboardPanelProps) {
  return (
    <section
      className={[
        "flex flex-col bg-[var(--panel-bg)] [border:var(--panel-border)]",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-16 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <h2 className="label-micro min-w-0 truncate text-[var(--color-text-primary)]">
          {title}
        </h2>
        <span className="flex-none whitespace-nowrap">{meta}</span>
      </div>
      {children}
    </section>
  );
}
