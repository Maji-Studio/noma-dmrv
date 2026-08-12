"use client";

import { TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { EntitySelect, FormField, FormInput, StockReconciliationLink } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { useStockAvailability } from "@/hooks/use-stock-availability";
import {
  binStockOverdrawInlineMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";
import { MASS_KG_INPUT_STEP } from "@/schemas/helpers";

interface ProductionRunFeedstockDrawRowProps {
  index: number;
  facilityId?: string;
  productionRunId?: string;
  storageLocationId?: string;
  wetMassKg?: number | null;
  selectedStorageLocationIds: readonly string[];
  storageLocationError?: string;
  wetMassError?: string;
  disabled?: boolean;
  onStorageLocationChange: (value: string | undefined) => void;
  onWetMassChange: (value: number | null) => void;
  onStorageLocationBlur: () => void;
  onWetMassBlur: () => void;
  storageLocationName: string;
  wetMassName: string;
  storageLocationRef: React.Ref<HTMLElement>;
  wetMassRef: React.Ref<HTMLInputElement>;
  onRemove: () => void;
}

export function ProductionRunFeedstockDrawRow({
  index,
  facilityId,
  productionRunId,
  storageLocationId,
  wetMassKg,
  selectedStorageLocationIds,
  storageLocationError,
  wetMassError,
  disabled,
  onStorageLocationChange,
  onWetMassChange,
  onStorageLocationBlur,
  onWetMassBlur,
  storageLocationName,
  wetMassName,
  storageLocationRef,
  wetMassRef,
  onRemove,
}: ProductionRunFeedstockDrawRowProps) {
  const { data: availability } = useStockAvailability(
    storageLocationId
      ? {
          kind: "productionRunFeedstock",
          storageLocationId,
          productionRunId,
        }
      : null,
  );
  const stockError =
    typeof wetMassKg === "number" &&
    availability?.availableKg != null &&
    isStockOverdraw(wetMassKg, availability.availableKg)
      ? binStockOverdrawInlineMessage("feedstock", availability.availableKg)
      : undefined;
  const resolvedWetMassError = wetMassError ?? stockError;

  return (
    <div
      className="border border-[var(--color-border-tertiary)] p-16 space-y-12"
      data-testid={`feedstock-draw-row-${index}`}
    >
      <div className="flex items-center justify-between gap-12">
        <span className="body-small font-medium text-[var(--color-text-secondary)]">
          Feedstock source {index + 1}
        </span>
        <Button
          type="button"
          variant="destructive"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove feedstock source ${index + 1}`}
        >
          <TrashIcon size={16} weight="bold" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id={`feedstockDraws.${index}.storageLocationId`}
          label="Source bin"
          error={storageLocationError}
          required
        >
          <EntitySelect
            entityType="storageLocation"
            value={storageLocationId}
            onChange={onStorageLocationChange}
            placeholder="Select bin..."
            disabled={disabled || !facilityId}
            error={!!storageLocationError}
            filterBy={
              facilityId
                ? {
                    facilityId,
                    type: "feedstock_bin",
                    feedstockTypeUsage: "pyrolysis",
                  }
                : undefined
            }
            excludeIds={selectedStorageLocationIds.filter(
              (id) => id !== storageLocationId,
            )}
            autoSelectSingle={false}
          />
          <input
            ref={storageLocationRef as React.Ref<HTMLInputElement>}
            type="hidden"
            name={storageLocationName}
            value={storageLocationId ?? ""}
            onBlur={onStorageLocationBlur}
            readOnly
          />
        </FormField>

        <div>
          <FormField
            id={`feedstockDraws.${index}.wetMassKg`}
            label="Wet mass (kg)"
            error={resolvedWetMassError}
            hint="As-received weight from this bin, water included."
            required
          >
            <FormInput
              ref={wetMassRef}
              id={`feedstockDraws.${index}.wetMassKg`}
              name={wetMassName}
              type="number"
              step={MASS_KG_INPUT_STEP}
              min="0"
              placeholder="e.g. 500"
              disabled={disabled}
              error={!!resolvedWetMassError}
              value={wetMassKg ?? ""}
              onBlur={onWetMassBlur}
              onChange={(event) => {
                const value = event.target.value.trim();
                onWetMassChange(value === "" ? null : Number(value));
              }}
            />
          </FormField>
          {stockError && facilityId && (
            <StockReconciliationLink facilityId={facilityId} />
          )}
        </div>
      </div>
    </div>
  );
}
