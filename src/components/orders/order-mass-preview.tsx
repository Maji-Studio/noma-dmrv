"use client";

import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { allocateTrackedDryBiocharKg } from "@/lib/biochar-mass-accounting";
import { parseWatchedNumber } from "@/lib/mass-moisture";

interface OrderMassPreviewProps {
  quantityKg: unknown;
  productWetBasisKg: number | null | undefined;
  productDryBiocharKg: number | null | undefined;
}

/**
 * Planning estimate of the dry biochar represented by an ordered wet mass.
 */
export function OrderMassPreview({
  quantityKg,
  productWetBasisKg,
  productDryBiocharKg,
}: OrderMassPreviewProps) {
  const wetKg = parseWatchedNumber(quantityKg);
  const dryBiocharKg = allocateTrackedDryBiocharKg({
    totalWetKg: productWetBasisKg,
    totalDryBiocharKg: productDryBiocharKg,
    requestedWetKg: wetKg,
  });

  return (
    <ProductCompositionPreview
      testId="order-mass-preview"
      wetMassKg={wetKg}
      dryBiocharKg={dryBiocharKg}
      wetLabel="Wet biochar product reserved"
      estimate
      note="The estimate assumes the recorded product mixture is homogeneous."
    />
  );
}
