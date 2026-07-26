"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { numericValue } from "@/lib/form-utils";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { FormActions } from "@/components/forms/form-actions";
import {
  vehicleFormSchema,
  VEHICLE_TYPE_OPTIONS,
  FUEL_TYPE_OPTIONS,
  lPerKmToLPer100Km,
  type VehicleFormData,
} from "@/schemas/vehicles";
import type { Vehicle } from "@/db/schema/logistics";

interface VehicleFormProps {
  vehicle?: Vehicle;
  onSubmit: (data: VehicleFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  submitLabel?: string;
}

export function VehicleForm({
  vehicle,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: VehicleFormProps) {
  const isEditMode = !!vehicle;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: {
      name: vehicle?.name ?? "",
      identifier: vehicle?.identifier ?? "",
      vehicleType: vehicle?.vehicleType ?? "",
      fuelType: vehicle?.fuelType ?? "",
      fuelConsumptionLPer100Km: vehicle?.fuelConsumptionLPerKm
        ? lPerKmToLPer100Km(vehicle.fuelConsumptionLPerKm)
        : undefined,
      modelYear: vehicle?.modelYear ?? undefined,
    },
  });

  const watchedFuelType = useWatch({ control, name: "fuelType" });
  const isElectric = watchedFuelType === "Electric";

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data))} className="space-y-20">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="name" label="Name" error={errors.name?.message} required>
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Feedstock Truck 01"
            disabled={isSubmitting}
            error={!!errors.name}
            autoFocus
            {...register("name")}
          />
        </FormField>

        <FormField
          id="identifier"
          label="Identifier / Plate"
          error={errors.identifier?.message}
        >
          <FormInput
            id="identifier"
            type="text"
            placeholder="e.g., T 123 DEC"
            disabled={isSubmitting}
            error={!!errors.identifier}
            {...register("identifier")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="vehicleType"
          label="Vehicle type"
          error={errors.vehicleType?.message}
          required
        >
          <FormSelect
            id="vehicleType"
            placeholder="Select type..."
            disabled={isSubmitting}
            error={!!errors.vehicleType}
            options={VEHICLE_TYPE_OPTIONS}
            {...register("vehicleType")}
          />
        </FormField>

        <FormField
          id="fuelType"
          label="Fuel type"
          error={errors.fuelType?.message}
        >
          <FormSelect
            id="fuelType"
            placeholder="Select fuel..."
            disabled={isSubmitting}
            error={!!errors.fuelType}
            options={FUEL_TYPE_OPTIONS}
            {...register("fuelType")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        {!isElectric && (
          <FormField
            id="fuelConsumptionLPer100Km"
            label="Fuel consumption (L/100 km)"
            error={errors.fuelConsumptionLPer100Km?.message}
          >
            <FormInput
              id="fuelConsumptionLPer100Km"
              type="number"
              step="any"
              min="0.1"
              max="1000"
              placeholder="e.g., 30"
              disabled={isSubmitting}
              error={!!errors.fuelConsumptionLPer100Km}
              {...register("fuelConsumptionLPer100Km", { setValueAs: numericValue })}
            />
          </FormField>
        )}

        <FormField
          id="modelYear"
          label="Model year"
          error={errors.modelYear?.message}
        >
          <FormInput
            id="modelYear"
            type="number"
            min="1900"
            max={new Date().getFullYear() + 1}
            placeholder="e.g., 2020"
            disabled={isSubmitting}
            error={!!errors.modelYear}
            {...register("modelYear", { setValueAs: numericValue })}
          />
        </FormField>
      </div>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={isEditMode ? "Update Vehicle" : "Create Vehicle"}
      />
    </form>
  );
}
