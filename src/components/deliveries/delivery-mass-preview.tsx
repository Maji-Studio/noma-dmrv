"use client";

import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { allocateTrackedDryBiocharKg } from "@/lib/biochar-mass-accounting";
import { parseWatchedNumber } from "@/lib/mass-moisture";

interface DeliveryMassPreviewProps {
  deliveredWetMassKg: unknown;
  allocationWetBasisKg: number | null | undefined;
  allocationDryBasisKg: number | null | undefined;
  moisturePercent: unknown;
  /**
   * The record's stored (wet, dry) pair in edit mode. The live allocation
   * collapses to null when any sibling delivery on the same order/product has
   * an unresolved dry mass; an unchanged record must then keep showing its
   * own persisted dry mass instead of "Not recorded" (DR-002 / DL-26-001).
   * The fallback applies only while the entered wet mass still equals the
   * stored one — an edited mass genuinely has no dry figure until it is
   * re-derived on save.
   */
  persisted?: {
    deliveredWetMassKg: number | null;
    massDryKg: number | null;
  } | null;
}

export function DeliveryMassPreview({
  deliveredWetMassKg,
  allocationWetBasisKg,
  allocationDryBasisKg,
  moisturePercent,
  persisted = null,
}: DeliveryMassPreviewProps) {
  const wetMassKg = parseWatchedNumber(deliveredWetMassKg);
  const liveDryBiocharKg = allocateTrackedDryBiocharKg({
    totalWetKg: allocationWetBasisKg,
    totalDryBiocharKg: allocationDryBasisKg,
    requestedWetKg: wetMassKg,
  });
  const dryBiocharKg =
    liveDryBiocharKg ??
    (persisted != null &&
    persisted.massDryKg != null &&
    wetMassKg === persisted.deliveredWetMassKg
      ? persisted.massDryKg
      : null);

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
