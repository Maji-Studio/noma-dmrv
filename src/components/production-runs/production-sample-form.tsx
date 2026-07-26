/**
 * ProductionSampleForm component
 * Form for creating/editing in-process field measurements during pyrolysis runs
 */
"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { nullableNumericValue } from "@/lib/form-utils";
import { formatLocalDateTime } from "@/lib/date-utils";
import { FormField, FormInput, FormFileUpload, FormActions, FormSection, MoistureField } from "@/components/forms";
import { EntitySelect } from "@/components/forms/entity-select";
import { FormTextarea } from "@/components/forms/form-textarea";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import {
  productionSampleFormSchema,
  type ProductionSampleFormData,
} from "@/schemas/production-samples";
import type { ProductionSampleWithRelations } from "@/data-access/production-samples";

// ============================================
// Component
// ============================================

interface ProductionSampleFormProps {
  productionRunId: string;
  sample?: ProductionSampleWithRelations;
  onSubmit: (data: ProductionSampleFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  deferredAttachments: UseDeferredAttachmentsResult;
  onRetryDeferredAttachment: (key?: string) => Promise<unknown>;
  onRemoveDeferredAttachment: (key: string) => void;
}

export function ProductionSampleForm({
  productionRunId,
  sample,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  deferredAttachments,
  onRetryDeferredAttachment,
  onRemoveDeferredAttachment,
}: ProductionSampleFormProps) {
  const isEditMode = !!sample;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(productionSampleFormSchema),
    defaultValues: (() => {
      const ts = sample?.timestamp ? new Date(sample.timestamp) : new Date();
      return {
      productionRunId,
      timestamp: formatLocalDateTime(ts),
      weightGrams: sample?.weightGrams ?? undefined,
      volumeMl: sample?.volumeMl ?? undefined,
      temperatureC: sample?.temperatureC ?? undefined,
      moistureContentPercent: sample?.moistureContentPercent ?? undefined,
      fixedCarbonPercent: sample?.fixedCarbonPercent ?? undefined,
      volatileMatterPercent: sample?.volatileMatterPercent ?? undefined,
      ashContentPercent: sample?.ashContentPercent ?? undefined,
      photoUrl: sample?.photoUrl ?? "",
      sampledById: sample?.sampledById ?? "",
      notes: sample?.notes ?? "",
    };
    })(),
  });

  // Rendered via the parent ProductionRunForm's `children` slot, which lives
  // outside its <form> element — so a real <form> is safe here (no nesting).
  const onFormSubmit = handleSubmit((data) => onSubmit(data as ProductionSampleFormData));

  return (
    <form className="space-y-20" onSubmit={onFormSubmit}>
      {/* Sample info */}
      <FormSection title="Sample info" divider={false}>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="timestamp"
            label="Timestamp"
            error={errors.timestamp?.message}
            required
          >
            <FormInput
              id="timestamp"
              type="datetime-local"
              disabled={isSubmitting}
              error={!!errors.timestamp}
              {...register("timestamp")}
            />
          </FormField>

          <FormField
            id="sampledById"
            label="Sampled by"
            error={errors.sampledById?.message}
          >
            <Controller
              name="sampledById"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="operator"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="Select operator..."
                  disabled={isSubmitting}
                  error={!!errors.sampledById}
                />
              )}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Physical measurements */}
      <FormSection title="Physical measurements">

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-16">
          <FormField
            id="weightGrams"
            label="Weight (g)"
            error={errors.weightGrams?.message}
          >
            <FormInput
              id="weightGrams"
              type="number"
              step="any"
              placeholder="e.g. 250"
              disabled={isSubmitting}
              error={!!errors.weightGrams}
              {...register("weightGrams", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="volumeMl"
            label="Volume (mL)"
            error={errors.volumeMl?.message}
          >
            <FormInput
              id="volumeMl"
              type="number"
              step="any"
              placeholder="e.g. 500"
              disabled={isSubmitting}
              error={!!errors.volumeMl}
              {...register("volumeMl", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="temperatureC"
            label="Temperature (°C)"
            error={errors.temperatureC?.message}
          >
            <FormInput
              id="temperatureC"
              type="number"
              step="any"
              placeholder="e.g. 550"
              disabled={isSubmitting}
              error={!!errors.temperatureC}
              {...register("temperatureC", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Proximate analysis */}
      <FormSection title="Proximate analysis">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <MoistureField
            id="moistureContentPercent"
            error={errors.moistureContentPercent?.message}
            disabled={isSubmitting}
            placeholder="e.g. 5.2"
            step="any"
            registration={register("moistureContentPercent", {
              setValueAs: nullableNumericValue,
            })}
          />

          <FormField
            id="fixedCarbonPercent"
            label="Fixed carbon (%)"
            error={errors.fixedCarbonPercent?.message}
          >
            <FormInput
              id="fixedCarbonPercent"
              type="number"
              step="any"
              placeholder="e.g. 75.0"
              disabled={isSubmitting}
              error={!!errors.fixedCarbonPercent}
              {...register("fixedCarbonPercent", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="volatileMatterPercent"
            label="Volatile matter (%)"
            error={errors.volatileMatterPercent?.message}
          >
            <FormInput
              id="volatileMatterPercent"
              type="number"
              step="any"
              placeholder="e.g. 15.0"
              disabled={isSubmitting}
              error={!!errors.volatileMatterPercent}
              {...register("volatileMatterPercent", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="ashContentPercent"
            label="Ash content (%)"
            error={errors.ashContentPercent?.message}
          >
            <FormInput
              id="ashContentPercent"
              type="number"
              step="any"
              placeholder="e.g. 4.8"
              disabled={isSubmitting}
              error={!!errors.ashContentPercent}
              {...register("ashContentPercent", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Documentation */}
      <FormSection title="Documentation">

        {isEditMode && (
          <FailedDeferredAttachments
            attachments={deferredAttachments.attachments}
            onRetry={onRetryDeferredAttachment}
            onRemove={onRemoveDeferredAttachment}
            disabled={isSubmitting}
          />
        )}

        <FormField
          id="attachments"
          label="Attachments"
          helperText="Upload sample photos or measurement records"
        >
          <FormFileUpload
            id="attachments"
            accept="image/*,.pdf,.csv,.xlsx"
            multiple
            maxSizeMb={50}
            disabled={isSubmitting}
            {...(isEditMode
              ? {
                  entityType: "production_sample",
                  entityId: sample.id,
                  documentType: "lab_report" as const,
                }
              : {
                  deferred: true,
                  deferredFiles: deferredAttachments.attachments,
                  onDeferredAdd: (files: File[]) =>
                    deferredAttachments.add(files, "lab_report"),
                  onDeferredRemove: deferredAttachments.remove,
                })}
          />
        </FormField>

        <FormField id="notes" label="Notes" error={errors.notes?.message}>
          <FormTextarea
            id="notes"
            rows={3}
            placeholder="Observations, conditions, etc."
            disabled={isSubmitting}
            {...register("notes")}
          />
        </FormField>
      </FormSection>

      <FormActions
        sticky={false}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={isEditMode ? "Save Changes" : "Add Sample"}
      />
    </form>
  );
}
