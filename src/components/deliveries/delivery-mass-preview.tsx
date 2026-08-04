"use client";

import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { allocateTrackedDryBiocharKg } from "@/lib/biochar-mass-accounting";
import { parseWatchedNumber } from "@/lib/mass-moisture";

interface DeliveryMassPreviewProps {
  deliveredWetMassKg: unknown;
  allocationWetBasisKg: number | null | undefined;
  allocationDryBasisKg: number | null | undefined;
  moisturePercent: unknown;
}

export function DeliveryMassPreview({
  deliveredWetMassKg,
  allocationWetBasisKg,
  allocationDryBasisKg,
  moisturePercent,
}: DeliveryMassPreviewProps) {
  const wetMassKg = parseWatchedNumber(deliveredWetMassKg);
  const dryBiocharKg = allocateTrackedDryBiocharKg({
    totalWetKg: allocationWetBasisKg,
    totalDryBiocharKg: allocationDryBasisKg,
    requestedWetKg: wetMassKg,
  });

  return (
    <ProductCompositionPreview
      testId="delivery-mass-preview"
      className="md:col-span-2"
      wetMassKg={wetMassKg}
      dryBiocharKg={dryBiocharKg}
      moisturePercent={parseWatchedNumber(moisturePercent)}
      note="Dry biochar is allocated from the linked product's tracked composition."
    />
  );
}
