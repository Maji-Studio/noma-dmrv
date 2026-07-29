"use client";

import { MoistureSplit } from "@/components/ui/moisture-split";
import { parseWatchedNumber } from "@/lib/mass-moisture";

interface OrderMassPreviewProps {
  quantityKg: unknown;
  moisturePercent: number | null | undefined;
}

/**
 * Live split of the ordered wet product mass using the selected product's
 * authoritative moisture.
 */
export function OrderMassPreview({
  quantityKg,
  moisturePercent,
}: OrderMassPreviewProps) {
  return (
    <div
      data-testid="order-mass-preview"
      className="border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-medium)] px-16 py-12"
    >
      <MoistureSplit
        wetMassKg={parseWatchedNumber(quantityKg)}
        moisturePercent={moisturePercent}
        wetLabel="Wet biochar product"
        dryLabel="Dry biochar"
      />
    </div>
  );
}
