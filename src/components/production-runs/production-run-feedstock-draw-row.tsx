"use client";

import { TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { EntitySelect, FormField, FormInput, StockReconciliationLink } from "@/components/forms";
import { StorageBinActions } from "@/components/storage-locations/storage-bin-actions";
import { Button } from "@/components/ui/button";
import { useStockAvailability } from "@/hooks/use-stock-availability";
import {
  binStockOverdrawInlineMessage,
  formatStockLimitKg,
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
  const availableKg = availability?.availableKg ?? null;
  const stockError =
    typeof wetMassKg === "number" &&
    availableKg != null &&
    isStockOverdraw(wetMassKg, availableKg)
      ? binStockOverdrawInlineMessage("feedstock", availableKg)
      : undefined;
  const resolvedWetMassError = wetMassError ?? stockError;

  return (
    <div
      className="space-y-12"
      data-testid={`feedstock-draw-row-${index}`}
    >
      <div className="flex items-center justify-between gap-12">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
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

      {/* The bin column is wider: it carries the View and Edit buttons. */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-16 gap-y-20">
        <FormField
          id={`feedstockDraws.${index}.storageLocationId`}
          label="Source bin"
          error={storageLocationError}
          required
        >
          <EntitySelect
            id={`feedstockDraws.${index}.storageLocationId`}
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
            // The wet mass cue states what this draw may take; the bin's
            // Remaining now line would be a second, near-identical figure.
            showRemainingMass={availableKg == null}
            trailingActions={<StorageBinActions storageLocationId={storageLocationId} />}
          />
        </FormField>
        <input
          ref={storageLocationRef as React.Ref<HTMLInputElement>}
          type="hidden"
          name={storageLocationName}
          value={storageLocationId ?? ""}
          onBlur={onStorageLocationBlur}
          readOnly
        />

        <div>
          <FormField
            id={`feedstockDraws.${index}.wetMassKg`}
            label="Wet mass (kg)"
            error={resolvedWetMassError}
            cue={availableKg != null ? `${formatStockLimitKg(availableKg)} available ${productionRunId ? "to this run" : "in this bin"}` : undefined}
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
