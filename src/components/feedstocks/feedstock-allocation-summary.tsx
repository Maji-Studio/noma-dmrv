import { exceedsMassWithTolerance } from "@/lib/calculations/mass-dry";
import { formatMassKg } from "@/lib/format-utils";

const MIN_DISPLAYED_DIFFERENCE_KG = 0.01;

function formatUnallocatedKg(unallocatedKg: number): string {
  if (
    unallocatedKg > 0 &&
    unallocatedKg < MIN_DISPLAYED_DIFFERENCE_KG
  ) {
    return `<${MIN_DISPLAYED_DIFFERENCE_KG} kg`;
  }

  return `${unallocatedKg.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} kg`;
}

interface FeedstockAllocationSummaryProps {
  allocatedKg: number;
  deliveredKg?: number | null;
}

export function FeedstockAllocationSummary({
  allocatedKg,
  deliveredKg,
}: FeedstockAllocationSummaryProps) {
  const hasDeliveredMass =
    typeof deliveredKg === "number" && Number.isFinite(deliveredKg);
  const hasUnallocatedMass =
    Number.isFinite(allocatedKg) &&
    hasDeliveredMass &&
    exceedsMassWithTolerance(deliveredKg, allocatedKg);
  const unallocatedKg = hasDeliveredMass ? deliveredKg - allocatedKg : 0;

  return (
    <div className="border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-12 py-8">
      <p className="body-small text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text-primary)]">
          {formatMassKg(allocatedKg)}
        </span>{" "}
        {hasDeliveredMass
          ? `of ${formatMassKg(deliveredKg)} allocated`
          : "allocated"}
      </p>
      {hasUnallocatedMass && (
        <p
          className="body-caption text-[var(--st-wait)] mt-4"
          role="status"
          aria-live="polite"
        >
          {formatUnallocatedKg(unallocatedKg)} remains unallocated. Allocate it or
          review the difference before saving.
        </p>
      )}
    </div>
  );
}
