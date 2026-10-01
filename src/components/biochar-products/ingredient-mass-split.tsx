"use client";

import { MoistureSplit } from "@/components/ui/moisture-split";
import { parseWatchedNumber } from "@/lib/mass-moisture";
import { useWatch, type Control, type FieldValues } from "react-hook-form";
import { ingredientSolidsLabel } from "./product-composition-components";

/**
 * One ingredient's wet mass as solids and water, flat under its mass and
 * moisture fields, the way the biochar split sits under the biochar's.
 *
 * A saved product with a frozen allocation splits against the dry snapshot
 * recorded at creation, so the bar and the product composition below agree;
 * a new product splits at the entered moisture.
 */
export function IngredientMassSplit({
  control,
  index,
  feedstockTypeName,
  frozen,
}: {
  control: Control<FieldValues>;
  index: number;
  feedstockTypeName: string;
  frozen: boolean;
}) {
  const prefix = `ingredientBins.${index}`;
  const massKg = useWatch({ control, name: `${prefix}.massKg` });
  const moisturePercent = useWatch({ control, name: `${prefix}.moistureContentPercent` });
  const massDryKg = useWatch({ control, name: `${prefix}.massDryKg` });

  return (
    <MoistureSplit
      wetMassKg={parseWatchedNumber(massKg)}
      moisturePercent={parseWatchedNumber(moisturePercent)}
      dryMassKg={frozen ? parseWatchedNumber(massDryKg) : undefined}
      materialLabel={feedstockTypeName}
      dryLabel={ingredientSolidsLabel(feedstockTypeName)}
    />
  );
}
