/**
 * FeedstockForm component
 * Multi-section form for creating/editing feedstocks
 */
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { numericValue } from "@/lib/form-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { FormField, FormInput, FormTextarea, FormEntitySelect } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  feedstockFormSchema,
  type FeedstockFormData,
} from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
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
      facilityId: feedstock?.facilityId ?? "",
      massWetKg: feedstock?.massWetKg ?? ("" as unknown as number),
      moistureContentPercent: feedstock?.moistureContentPercent ?? ("" as unknown as number),
      massDryKg: feedstock?.massDryKg ?? ("" as unknown as number),
      storageLocationId: feedstock?.storageLocationId ?? "",
      feedstockSourceRegion: feedstock?.feedstockSourceRegion ?? "",
      notes: feedstock?.notes ?? "",
    },
  });

  const deliveryId = watch("feedstockDeliveryId");
  const watchWetMass = watch("massWetKg");
  const watchMoisture = watch("moistureContentPercent");

  // Auto-calculate dry mass from wet mass and moisture using shared utility
  const calculatedDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  // Sync calculated dry mass into the form (clear when inputs become invalid)
  useEffect(() => {
    if (calculatedDryMass !== null) {
      setValue("massDryKg", calculatedDryMass);
    } else {
      setValue("massDryKg", "" as unknown as number);
    }
  }, [calculatedDryMass, setValue]);

  // Auto-populate facilityId when delivery changes
  useEffect(() => {
    if (!deliveryId) return;

    let active = true;
    getFeedstockDeliveryByIdFn(deliveryId).then((result) => {
      if (active && result.success) {
        setValue("facilityId", result.data.facilityId);
      }
    });
    return () => { active = false; };
  }, [deliveryId, setValue]);

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

          <div className="grid grid-cols-1 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={control}
              name="feedstockDeliveryId"
              label="Feedstock Delivery"
              entityType="feedstockDelivery"
              placeholder="Select delivery..."
              disabled={isSubmitting}
              required
            />
          </div>
        </div>

        {/* Mass & Moisture Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Mass & Moisture
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="massWetKg"
              label="Wet Mass (kg)"
              error={errors.massWetKg?.message}
              helperText="As-received weight"
              required
            >
              <FormInput
                id="massWetKg"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 1800"
                disabled={isSubmitting}
                error={!!errors.massWetKg}
                {...register("massWetKg", { setValueAs: numericValue })}
              />
            </FormField>

            <FormField
              id="moistureContentPercent"
              label="Moisture (%)"
              error={errors.moistureContentPercent?.message}
              helperText="0–100%"
              required
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
                {...register("moistureContentPercent", { setValueAs: numericValue })}
              />
            </FormField>
          </div>

          {/* Auto-calculated dry mass */}
          <div className="flex items-center gap-12 rounded-sm border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
            <span className="body-small text-[var(--color-text-tertiary)]">Dry Mass (kg)</span>
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {calculatedDryMass !== null
                ? `${calculatedDryMass.toFixed(2)} kg`
                : "—"}
            </span>
            {calculatedDryMass !== null && (
              <span className="body-small text-[var(--color-text-quaternary)]">
                = {watchWetMass} × (1 − {watchMoisture}%)
              </span>
            )}
          </div>
          {errors.massDryKg?.message && (
            <p className="body-small text-[var(--color-status-error)]">{errors.massDryKg.message}</p>
          )}

          {/* Hidden field to submit calculated value */}
          <input type="hidden" {...register("massDryKg", { setValueAs: numericValue })} />
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
              label="Storage Location"
              entityType="storageLocation"
              placeholder="Select feedstock bin..."
              disabled={isSubmitting}
              filterBy={{ type: "feedstock_bin" }}
            />

            <FormField
              id="feedstockSourceRegion"
              label="Source Region"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="notes"
              label="Notes"
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
    </>
  );
}
