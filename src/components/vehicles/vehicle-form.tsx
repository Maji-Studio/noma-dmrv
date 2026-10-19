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
  selectOptionsForStoredValue,
  type VehicleFormData,
} from "@/schemas/vehicles";
import type { Vehicle } from "@/db/schema/logistics";
import { numberInputConstraintsFor } from "@/lib/number-input-constraints";

/** Native min, max and step for each number input, read from the schema. */
const numberBounds = numberInputConstraintsFor(vehicleFormSchema);

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
  const vehicleTypeField = selectOptionsForStoredValue(VEHICLE_TYPE_OPTIONS, vehicle?.vehicleType, { ignoreCase: false });
  const fuelTypeField = selectOptionsForStoredValue(FUEL_TYPE_OPTIONS, vehicle?.fuelType, { ignoreCase: true });

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
      vehicleType: vehicleTypeField.value,
      fuelType: fuelTypeField.value,
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
          label="Identifier / plate"
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

      <div className="grid grid-cols-1 gap-x-16 gap-y-20">
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
            options={vehicleTypeField.options}
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
            options={fuelTypeField.options}
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
              {...numberBounds("fuelConsumptionLPer100Km")}
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
            {...numberBounds("modelYear")}
            placeholder="e.g., 2020"
            disabled={isSubmitting}
            error={!!errors.modelYear}
            {...register("modelYear", { setValueAs: numericValue })}
          />
        </FormField>
      </div>

      <FormActions
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={isEditMode ? "Update vehicle" : "Create vehicle"}
      />
    </form>
  );
}
