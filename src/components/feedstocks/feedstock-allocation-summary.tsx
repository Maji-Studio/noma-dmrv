import { exceedsMassWithTolerance } from "@/lib/calculations/mass-dry";

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
          {allocatedKg.toFixed(2)} kg
        </span>{" "}
        {hasDeliveredMass
          ? `of ${deliveredKg.toFixed(2)} kg allocated`
          : "allocated"}
      </p>
      {hasUnallocatedMass && (
        <p
          className="body-caption text-[var(--st-wait)] mt-4"
          role="status"
          aria-live="polite"
        >
          {unallocatedKg.toFixed(2)} kg not allocated.
        </p>
      )}
    </div>
  );
}
