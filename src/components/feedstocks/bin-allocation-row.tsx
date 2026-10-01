/**
 * BinAllocationRow component
 * Repeatable row for allocating dry mass to a storage bin.
 * Used in the feedstock intake form's allocation section.
 */
"use client";

import { TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { useWatch, type Control, type UseFormRegisterReturn, type FieldError } from "react-hook-form";
import { FormField, FormInput, FormEntitySelect } from "@/components/forms";
import { StorageBinActions } from "@/components/storage-locations/storage-bin-actions";
import { Button } from "@/components/ui/button";
import { MASS_KG_INPUT_STEP } from "@/schemas/helpers";

interface BinAllocationRowProps {
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  massRegister: UseFormRegisterReturn;
  massError?: FieldError;
  /** Whether to show delete button (hidden for single allocation) */
  canRemove: boolean;
  onRemove: () => void;
  disabled?: boolean;
  /** Storage location type filter based on feedstock type category */
  binTypeFilter?: string;
  /** Facility ID to scope storage bin options */
  facilityId?: string;
  /** Feedstock type ID to filter out incompatible bins */
  feedstockTypeId?: string;
  /** Callback to open quick-add dialog for creating a new bin */
  onCreateNew?: () => void;
}

export function BinAllocationRow({
  index,
  control,
  massRegister,
  massError,
  canRemove,
  onRemove,
  disabled,
  binTypeFilter = "feedstock_bin",
  facilityId,
  feedstockTypeId,
  onCreateNew,
}: BinAllocationRowProps) {
  const storageLocationId: string | undefined = useWatch({
    control,
    name: `allocations.${index}.storageLocationId`,
  });

  return (
    <div className="flex items-start gap-12">
      {/* The bin column is wider: it carries the View and Edit buttons. */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-16 gap-y-12 flex-1">
        <FormEntitySelect
          control={control}
          name={`allocations.${index}.storageLocationId`}
          label="Storage bin"
          entityType="storageLocation"
          placeholder="Select bin..."
          disabled={disabled}
          required
          autoSelectSingle={false}
          filterBy={{
            type: binTypeFilter,
            ...(facilityId ? { facilityId } : {}),
            ...(feedstockTypeId ? { feedstockTypeId } : {}),
          }}
          dependsOn={[feedstockTypeId, facilityId]}
          allowCreate={Boolean(onCreateNew)}
          onCreateNew={onCreateNew}
          trailingActions={<StorageBinActions storageLocationId={storageLocationId} />}
        />

        <FormField
          id={`allocations.${index}.allocatedWetMassKg`}
          label="Allocated wet mass (kg)"
          error={massError?.message}
          required
        >
          <FormInput
            id={`allocations.${index}.allocatedWetMassKg`}
            type="number"
            step={MASS_KG_INPUT_STEP}
            min="0"
            placeholder="e.g., 975"
            disabled={disabled}
            error={!!massError}
            {...massRegister}
          />
        </FormField>
      </div>

      {canRemove && (
        <Button
          variant="destructive"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          className="mt-28"
          aria-label="Remove allocation"
        >
          <TrashIcon size={18} />
        </Button>
      )}
    </div>
  );
}
