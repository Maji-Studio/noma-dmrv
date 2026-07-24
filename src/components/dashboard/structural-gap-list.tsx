import type { DashboardStructuralGap } from "@/data-access/dashboard-structural-gaps";
import { DashboardAttentionRow } from "./dashboard-attention-row";

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
        <DashboardAttentionRow
          key={gap.key}
          href={gap.href}
          metadata={gap.metadata}
          title={gap.label}
          divided={index > 0}
        />
      ))}
    </ul>
  );
}
