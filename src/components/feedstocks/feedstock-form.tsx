/**
 * FeedstockForm component
 * Multi-section form for creating/editing feedstocks
 */
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { numericValue, nullableNumericValue } from "@/lib/form-utils";
import { FormField, FormInput, FormTextarea, FormEntitySelect } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  feedstockFormSchema,
  type FeedstockFormData,
} from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import { FeedstockTypeQuickAddDialog } from "@/components/forms/entity-select/feedstock-type-quick-add-dialog";
import { useQuickAddDialog } from "@/components/forms/entity-select";
import { getFeedstockDeliveryByIdFn } from "@/fn/feedstock-deliveries";

// ============================================
// Component
// ============================================

interface FeedstockFormProps {
  feedstock?: FeedstockWithRelations;
  onSubmit: (data: FeedstockFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function FeedstockForm({
  feedstock,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: FeedstockFormProps) {
  const isEditMode = !!feedstock;

  const feedstockTypeDialog = useQuickAddDialog();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(feedstockFormSchema),
    defaultValues: {
      feedstockDeliveryId: feedstock?.feedstockDeliveryId ?? "",
      feedstockTypeId: feedstock?.feedstockTypeId ?? "",
      facilityId: feedstock?.facilityId ?? "",
      massDryKg: feedstock?.massDryKg ?? ("" as unknown as number),
      massWetKg: feedstock?.massWetKg ?? null,
      moistureContentPercent: feedstock?.moistureContentPercent ?? null,
      storageLocationId: feedstock?.storageLocationId ?? "",
      feedstockSourceRegion: feedstock?.feedstockSourceRegion ?? "",
      notes: feedstock?.notes ?? "",
    },
  });

  const deliveryId = watch("feedstockDeliveryId");

  // Auto-populate facilityId when delivery changes
  useEffect(() => {
    if (!deliveryId || isEditMode) return;

    let active = true;
    getFeedstockDeliveryByIdFn(deliveryId).then((result) => {
      if (active && result.success) {
        setValue("facilityId", result.data.facilityId);
      }
    });
    return () => { active = false; };
  }, [deliveryId, setValue, isEditMode]);

  const defaultSubmitLabel = isEditMode ? "Update Feedstock" : "Create Feedstock";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as FeedstockFormData);
  });

  return (
    <>
      <form onSubmit={handleFormSubmit} className="space-y-20">
        {/* Reference Section */}
        <div className="space-y-20">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Reference
          </h3>

          <FormEntitySelect
            control={control}
            name="feedstockDeliveryId"
            label="Feedstock Delivery"
            entityType="feedstockDelivery"
            placeholder="Select delivery..."
            disabled={isSubmitting}
          />

          <FormEntitySelect
            control={control}
            name="feedstockTypeId"
            label="Feedstock Type"
            entityType="feedstockType"
            placeholder="Select feedstock type..."
            disabled={isSubmitting}
            allowCreate
            createLabel="Add new feedstock type"
            onCreateNew={() => feedstockTypeDialog.open()}
          />
        </div>

        {/* Mass & Moisture Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Mass & Moisture
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
            <FormField
              id="massDryKg"
              label="Dry Mass (kg)"
              error={errors.massDryKg?.message}
              helperText="Required — oven-dry basis"
            >
              <FormInput
                id="massDryKg"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 1200"
                disabled={isSubmitting}
                error={!!errors.massDryKg}
                {...register("massDryKg", { setValueAs: numericValue })}
              />
            </FormField>

            <FormField
              id="massWetKg"
              label="Wet Mass (kg, optional)"
              error={errors.massWetKg?.message}
              helperText="As-received weight"
            >
              <FormInput
                id="massWetKg"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 1800"
                disabled={isSubmitting}
                error={!!errors.massWetKg}
                {...register("massWetKg", { setValueAs: nullableNumericValue })}
              />
            </FormField>

            <FormField
              id="moistureContentPercent"
              label="Moisture (%, optional)"
              error={errors.moistureContentPercent?.message}
              helperText="0–100%"
            >
              <FormInput
                id="moistureContentPercent"
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="e.g., 35"
                disabled={isSubmitting}
                error={!!errors.moistureContentPercent}
                {...register("moistureContentPercent", { setValueAs: nullableNumericValue })}
              />
            </FormField>
          </div>
        </div>

        {/* Storage Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Storage
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={control}
              name="storageLocationId"
              label="Storage Location (optional)"
              entityType="storageLocation"
              placeholder="Select feedstock bin..."
              disabled={isSubmitting}
              filterBy={{ type: "feedstock_bin" }}
            />

            <FormField
              id="feedstockSourceRegion"
              label="Source Region (optional)"
              error={errors.feedstockSourceRegion?.message}
            >
              <FormInput
                id="feedstockSourceRegion"
                placeholder="e.g., Western Kenya"
                disabled={isSubmitting}
                error={!!errors.feedstockSourceRegion}
                {...register("feedstockSourceRegion")}
              />
            </FormField>
          </div>
        </div>

        {/* Documentation Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Documentation
          </h3>

          <FormField
            id="notes"
            label="Notes (optional)"
            error={errors.notes?.message}
            helperText="Additional notes or documentation references"
          >
            <FormTextarea
              id="notes"
              placeholder="Enter any additional notes..."
              disabled={isSubmitting}
              error={!!errors.notes}
              rows={4}
              {...register("notes")}
            />
          </FormField>
        </div>

        {/* Hidden facilityId field */}
        <input type="hidden" {...register("facilityId")} />

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
          {onCancel && (
            <Button
              type="button"
              variant="default"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : submitLabel ?? defaultSubmitLabel}
          </Button>
        </div>
      </form>

      <FeedstockTypeQuickAddDialog
        isOpen={feedstockTypeDialog.isOpen}
        onClose={feedstockTypeDialog.close}
        onSuccess={(feedstockType) => {
          setValue("feedstockTypeId", feedstockType.id);
          feedstockTypeDialog.close();
        }}
      />
    </>
  );
}
