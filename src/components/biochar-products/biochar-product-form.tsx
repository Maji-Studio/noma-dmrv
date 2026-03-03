/**
 * BiocharProductForm component
 * Reusable biochar product form with React Hook Form integration
 * Used in both create and edit views for biochar products
 */
"use client";

import { nullableNumericValue } from "@/lib/form-utils";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormSelect, EntitySelect } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  biocharProductFormSchema,
  biocharProductStatusValues,
  type BiocharProductFormData,
} from "@/schemas/biochar-products";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

// ============================================
// Component
// ============================================

interface BiocharProductFormProps {
  /** Existing biochar product data for editing (undefined for create mode) */
  product?: BiocharProductWithRelations;
  /** Form submission handler */
  onSubmit: (data: BiocharProductFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

// Status display options
const statusOptions = biocharProductStatusValues.map((status) => ({
  value: status,
  label: status.charAt(0).toUpperCase() + status.slice(1),
}));

export function BiocharProductForm({
  product,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: BiocharProductFormProps) {
  const isEditMode = !!product;

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(biocharProductFormSchema),
    defaultValues: {
      facilityId: product?.facility?.id ?? "",
      formulationId: product?.formulation?.id ?? "",
      productionDate: product?.productionDate
        ? new Date(product.productionDate).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
      status: product?.status ?? "testing",
      linkedProductionRunId: product?.linkedProductionRun?.id ?? "",
      storageLocationId: product?.storageLocation?.id ?? "",
      massKg: product?.massKg ?? null,
      densityKgM3: product?.densityKgM3 ?? null,
    },
  });

  const selectedFacilityId = watch("facilityId");
  const defaultSubmitLabel = isEditMode ? "Update Product" : "Create Product";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as BiocharProductFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="productionDate"
            label="Production Date"
            error={errors.productionDate?.message}
          >
            <FormInput
              id="productionDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.productionDate}
              {...register("productionDate")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="facilityId"
            label="Facility"
            error={errors.facilityId?.message}
          >
            <Controller
              name="facilityId"
              control={control}
              render={({ field, fieldState }) => (
                <EntitySelect
                  entityType="facility"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a facility"
                  disabled={isSubmitting}
                  error={!!fieldState.error}
                />
              )}
            />
          </FormField>

          <FormField
            id="formulationId"
            label="Formulation"
            error={errors.formulationId?.message}
          >
            <Controller
              name="formulationId"
              control={control}
              render={({ field, fieldState }) => (
                <EntitySelect
                  entityType="formulation"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a formulation"
                  disabled={isSubmitting}
                  error={!!fieldState.error}
                />
              )}
            />
          </FormField>
        </div>
      </div>

      {/* Status Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Status
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="status"
            label="Product Status"
            error={errors.status?.message}
          >
            <FormSelect
              id="status"
              options={statusOptions}
              disabled={isSubmitting}
              error={!!errors.status}
              {...register("status")}
            />
          </FormField>
        </div>
      </div>

      {/* Measurements Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Measurements
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="massKg"
            label="Mass (kg, optional)"
            error={errors.massKg?.message}
            helperText="Total mass of the biochar product"
          >
            <FormInput
              id="massKg"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 500"
              disabled={isSubmitting}
              error={!!errors.massKg}
              {...register("massKg", { setValueAs: nullableNumericValue })}
            />
          </FormField>

          <FormField
            id="densityKgM3"
            label="Density (kg/m³, optional)"
            error={errors.densityKgM3?.message}
            helperText="Bulk density of the product"
          >
            <FormInput
              id="densityKgM3"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 350"
              disabled={isSubmitting}
              error={!!errors.densityKgM3}
              {...register("densityKgM3", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>
      </div>

      {/* Relations Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Related Records (Optional)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="linkedProductionRunId"
            label="Linked Production Run"
            error={errors.linkedProductionRunId?.message}
            helperText="Link to the production run that created this product"
          >
            <Controller
              name="linkedProductionRunId"
              control={control}
              render={({ field, fieldState }) => (
                <EntitySelect
                  entityType="productionRun"
                  value={field.value || ""}
                  onChange={field.onChange}
                  placeholder="Select a production run (optional)"
                  disabled={isSubmitting}
                  error={!!fieldState.error}
                  filterBy={selectedFacilityId ? { facilityId: selectedFacilityId } : undefined}
                />
              )}
            />
          </FormField>

          <FormField
            id="storageLocationId"
            label="Storage Location"
            error={errors.storageLocationId?.message}
            helperText="Current storage location for this product"
          >
            <Controller
              name="storageLocationId"
              control={control}
              render={({ field, fieldState }) => (
                <EntitySelect
                  entityType="storageLocation"
                  value={field.value || ""}
                  onChange={field.onChange}
                  placeholder="Select a storage location (optional)"
                  disabled={isSubmitting}
                  error={!!fieldState.error}
                  filterBy={selectedFacilityId ? { facilityId: selectedFacilityId } : undefined}
                />
              )}
            />
          </FormField>
        </div>
      </div>

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
  );
}
