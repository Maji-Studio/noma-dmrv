import { deriveSourceBiocharDryMassKg, deriveSourceBiocharMassKg, fromCompositionJsonb } from "@/lib/biochar-composition/composition";
import { sumNullable, sumNullableBy } from "@/lib/nullable-sum";

interface BiocharProductMassInput {
  massKg: number | null;
  waterAddedKg: number | null;
  moistureContentPercent: number | null;
  composition: unknown;
  sourceAllocatedDryMassKg: number | null;
}

export function sourceBiocharDryMassKg(
  product: Pick<
    BiocharProductMassInput,
    | "massKg"
    | "moistureContentPercent"
    | "composition"
    | "sourceAllocatedDryMassKg"
  >,
): number | null {
  return product.sourceAllocatedDryMassKg ?? deriveSourceBiocharDryMassKg(
    product.massKg,
    product.moistureContentPercent,
    fromCompositionJsonb(product.composition),
  );
}

/** Mass-flow displays prefer dry biochar, falling back to wet biochar without ingredients. */
export function sourceBiocharMassFlowKg(
  product: Parameters<typeof sourceBiocharDryMassKg>[0],
): number {
  return sourceBiocharDryMassKg(product) ?? deriveSourceBiocharMassKg(
    product.massKg,
    fromCompositionJsonb(product.composition),
  ) ?? 0;
}

export function finalWetProductMassKg(
  product: Pick<BiocharProductMassInput, "massKg" | "waterAddedKg">,
): number | null {
  return product.massKg == null
    ? null
    : sumNullable([product.massKg, product.waterAddedKg]);
}

export function summarizeBiocharProductMass(products: readonly BiocharProductMassInput[]) {
  const dryMassesKg = products.map(sourceBiocharDryMassKg);
  return {
    totalWetMassKg: sumNullableBy(products, finalWetProductMassKg),
    totalDryBiocharMassKg: dryMassesKg.some((massKg) => massKg === null)
      ? null
      : sumNullable(dryMassesKg),
  };
}
