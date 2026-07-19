import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { DashboardStructuralGap } from "@/data-access/dashboard-structural-gaps";

export function StructuralGapList({
  gaps,
}: {
  gaps: DashboardStructuralGap[];
}) {
  if (gaps.length === 0) return null;

  return (
    <ul
      className="flex flex-col border-b border-[var(--color-border-tertiary)] px-20 py-4"
      data-testid="structural-gap-list"
      aria-label="Structural certification gaps"
    >
      {gaps.map((gap, index) => (
        <li
          key={gap.key}
          className={
            index > 0 ? "border-t border-[var(--color-border-tertiary)]" : undefined
          }
        >
          <Link
            href={gap.href}
            className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-12 py-12"
          >
            <span className="body-small text-[var(--color-text-primary)]">
              {gap.label}
            </span>
            <span className="label-micro text-[var(--st-bad)]">
              {gap.count} {gap.count === 1 ? "gap" : "gaps"}
            </span>
            <ArrowRightIcon
              size={14}
              weight="bold"
              className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
