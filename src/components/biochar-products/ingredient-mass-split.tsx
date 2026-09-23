"use client";

import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import { BinMovementHistoryModal } from "@/components/storage-locations/bin-movement-history-modal";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { parseWatchedNumber } from "@/lib/mass-moisture";
import { useWatch, type Control, type FieldValues } from "react-hook-form";
import { ingredientSolidsLabel } from "./product-composition-components";

const HISTORY_LABEL = "Stock history";

/**
 * One ingredient's wet mass as solids and water, flat under its mass and
 * moisture fields, the way the biochar split sits under the biochar's.
 *
 * A saved product with a frozen allocation splits against the dry snapshot
 * recorded at creation, so the bar and the product composition below agree;
 * a new product splits at the entered moisture. Detailed adds the bin's
 * history as a quiet action under the bar.
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
  const storageLocationId = useWatch({ control, name: `${prefix}.storageLocationId` });
  const detailed = useFormDetailLevel() === "detailed";
  const binId = typeof storageLocationId === "string" && storageLocationId ? storageLocationId : null;

  return (
    <div className="flex flex-col gap-8">
      <MoistureSplit
        wetMassKg={parseWatchedNumber(massKg)}
        moisturePercent={parseWatchedNumber(moisturePercent)}
        dryMassKg={frozen ? parseWatchedNumber(massDryKg) : undefined}
        materialLabel={feedstockTypeName}
        dryLabel={ingredientSolidsLabel(feedstockTypeName)}
      />
      {detailed && binId && (
        <div className="flex">
          <BinMovementHistoryModal
            compact
            storageLocationId={binId}
            triggerLabel={HISTORY_LABEL}
            aria-label={`${HISTORY_LABEL}, ${feedstockTypeName} bin`}
          />
        </div>
      )}
    </div>
  );
}
