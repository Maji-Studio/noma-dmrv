/**
 * ProductionRunReadingForm component
 * Inline form for creating/editing time-series monitoring readings within a production run
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { nullableNumericValue } from "@/lib/form-utils";
import { formatLocalDateTime } from "@/lib/date-utils";
import { FormField, FormInput } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  productionRunReadingFormSchema,
  type ProductionRunReadingFormData,
} from "@/schemas/production-run-readings";
import type { ProductionRunReadingWithRelations } from "@/data-access/production-run-readings";

interface ProductionRunReadingFormProps {
  productionRunId: string;
  reading?: ProductionRunReadingWithRelations;
  onSubmit: (data: ProductionRunReadingFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function ProductionRunReadingForm({
  productionRunId,
  reading,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: ProductionRunReadingFormProps) {
  const isEditMode = !!reading;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductionRunReadingFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(productionRunReadingFormSchema) as any,
    defaultValues: {
      productionRunId,
      timestamp: formatLocalDateTime(
        reading?.timestamp ? new Date(reading.timestamp) : new Date()
      ),
      temperatureC: reading?.temperatureC ?? undefined,
      pressureBar: reading?.pressureBar ?? undefined,
      gasFlowRate: reading?.gasFlowRate ?? undefined,
    },
  });

  const onFormSubmit = handleSubmit((data) => onSubmit(data));

  return (
    <form onSubmit={onFormSubmit} className="space-y-20">
      {/* Timestamp */}
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

      {/* Measurements */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
        <FormField
          id="temperatureC"
          label="Temperature (°C)"
          error={errors.temperatureC?.message}
        >
          <FormInput
            id="temperatureC"
            type="number"
            step="0.1"
            placeholder="e.g. 550"
            disabled={isSubmitting}
            error={!!errors.temperatureC}
            {...register("temperatureC", {
              setValueAs: nullableNumericValue,
            })}
          />
        </FormField>

        <FormField
          id="pressureBar"
          label="Pressure (bar)"
          error={errors.pressureBar?.message}
        >
          <FormInput
            id="pressureBar"
            type="number"
            step="0.01"
            placeholder="e.g. 1.2"
            disabled={isSubmitting}
            error={!!errors.pressureBar}
            {...register("pressureBar", {
              setValueAs: nullableNumericValue,
            })}
          />
        </FormField>

        <FormField
          id="gasFlowRate"
          label="Gas Flow Rate"
          error={errors.gasFlowRate?.message}
        >
          <FormInput
            id="gasFlowRate"
            type="number"
            step="0.001"
            placeholder="e.g. 0.5"
            disabled={isSubmitting}
            error={!!errors.gasFlowRate}
            {...register("gasFlowRate", {
              setValueAs: nullableNumericValue,
            })}
          />
        </FormField>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-16">
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
          {isSubmitting
            ? "Saving..."
            : isEditMode
              ? "Save Changes"
              : "Add Reading"}
        </Button>
      </div>
    </form>
  );
}
