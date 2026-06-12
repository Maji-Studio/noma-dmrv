/**
 * BinAllocationRow component
 * Repeatable row for allocating dry mass to a storage bin.
 * Used in the feedstock intake form's allocation section.
 */
"use client";

import { Trash } from "@phosphor-icons/react";
import type { Control, UseFormRegisterReturn, FieldError } from "react-hook-form";
import { FormField, FormInput, FormEntitySelect } from "@/components/forms";

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
  return (
    <div className="flex items-start gap-12">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-12 flex-1">
        <FormEntitySelect
          control={control}
          name={`allocations.${index}.storageLocationId`}
          label="Storage Bin"
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
          createLabel="Add New Bin"
          onCreateNew={onCreateNew}
        />

        <FormField
          id={`allocations.${index}.allocatedWetMassKg`}
          label="Allocated Wet Mass (kg)"
          error={massError?.message}
          required
        >
          <FormInput
            id={`allocations.${index}.allocatedWetMassKg`}
            type="number"
            step="0.01"
            min="0"
            placeholder="e.g., 975"
            disabled={disabled}
            error={!!massError}
            {...massRegister}
          />
        </FormField>
      </div>

      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="mt-28 p-8 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)] transition-colors"
          aria-label="Remove allocation"
        >
          <Trash size={18} />
        </button>
      )}
    </div>
  );
}
