"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormActions,
  FormField,
  FormInput,
  FormSelect,
  ServerError,
  SectionLabel,
} from "@/components/forms";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/components/ui/toast";
import {
  emissionsCalculationMethods,
  transportLegFormSchema,
  transportMethods,
  type EmissionsCalculationMethodValue,
  type TransportEntityTypeValue,
  type TransportLegFormData,
  type TransportMethodValue,
} from "@/schemas/transport-legs";
import {
  useCreateTransportLeg,
  useUpdateTransportLeg,
} from "@/hooks/use-transport-legs";
import type { TransportLeg } from "@/db/schema";

interface TransportLegFormProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** When provided, the form is in edit mode for this leg. */
  leg?: TransportLeg | null;
}

const transportMethodOptions = transportMethods.map((m) => ({
  value: m,
  label: m.charAt(0).toUpperCase() + m.slice(1),
}));

const calculationMethodOptions = emissionsCalculationMethods.map((m) => ({
  value: m,
  label: m === "energy_usage" ? "Energy usage (preferred)" : "Distance-based",
}));

function legToFormDefaults(leg: TransportLeg | null | undefined) {
  return {
    originGpsLatitude: leg?.originGpsLatitude ?? null,
    originGpsLongitude: leg?.originGpsLongitude ?? null,
    originName: leg?.originName ?? "",
    destinationGpsLatitude: leg?.destinationGpsLatitude ?? null,
    destinationGpsLongitude: leg?.destinationGpsLongitude ?? null,
    destinationName: leg?.destinationName ?? "",
    distanceKm: leg?.distanceKm ?? undefined,
    transportMethodType: (leg?.transportMethodType ?? "road") as TransportMethodValue,
    vehicleType: leg?.vehicleType ?? "",
    modelYear: leg?.modelYear ?? null,
    fuelType: leg?.fuelType ?? "",
    fuelConsumedLiters: leg?.fuelConsumedLiters ?? null,
    electricityKwh: leg?.electricityKwh ?? null,
    loadMassKg: leg?.loadMassKg ?? null,
    calculationMethodType: (leg?.calculationMethodType ??
      "energy_usage") as EmissionsCalculationMethodValue,
    emissionFactorUsed: leg?.emissionFactorUsed ?? null,
    emissionFactorSource: leg?.emissionFactorSource ?? "",
    transportEmissionsCo2eKg: leg?.transportEmissionsCo2eKg ?? null,
    billOfLading: leg?.billOfLading ?? "",
    weighScaleTicketRef: leg?.weighScaleTicketRef ?? "",
  };
}

export function TransportLegForm({
  isOpen,
  onClose,
  entityType,
  entityId,
  leg,
}: TransportLegFormProps) {
  const isEditMode = !!leg;
  const defaultValues = legToFormDefaults(leg);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(transportLegFormSchema),
    defaultValues,
  });

  const dialogRef = useDialog(isOpen, onClose, () => reset(defaultValues));
  const toast = useToast();
  const createMutation = useCreateTransportLeg();
  const updateMutation = useUpdateTransportLeg(entityType, entityId);
  const watchedMethod = watch("calculationMethodType");

  const onSubmit = handleSubmit(async (raw) => {
    const data = raw as unknown as TransportLegFormData;
    try {
      if (isEditMode && leg) {
        await updateMutation.mutateAsync({ id: leg.id, ...data });
        toast.success("Transport leg updated");
      } else {
        await createMutation.mutateAsync({ ...data, entityType, entityId });
        toast.success("Transport leg added");
      }
      onClose();
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error
            ? error.message
            : "Failed to save transport leg",
      });
    }
  });

  if (!isOpen) return null;

  const isEnergyUsage = watchedMethod === "energy_usage";
  const isDistanceBased = watchedMethod === "distance_based";

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 w-[640px] max-w-[90vw] max-h-[90vh] overflow-auto"
      aria-labelledby="transport-leg-form-title"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-24 p-32">
        <header className="flex flex-col gap-4">
          <h2 id="transport-leg-form-title" className="title-heading-3">
            {isEditMode ? "Edit transport leg" : "Add transport leg"}
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Captures one trip&apos;s emissions for the chain-of-custody record.
          </p>
        </header>

        {errors.root?.serverError?.message && (
          <ServerError message={errors.root.serverError.message} />
        )}

        <div className="flex flex-col gap-16">
          <SectionLabel>Route</SectionLabel>
          <div className="grid grid-cols-2 gap-16">
            <FormField
              id="originName"
              label="Origin name"
              error={errors.originName?.message}
            >
              <FormInput
                id="originName"
                placeholder="e.g. Loading bay A"
                error={!!errors.originName}
                {...register("originName")}
              />
            </FormField>
            <FormField
              id="destinationName"
              label="Destination name"
              error={errors.destinationName?.message}
            >
              <FormInput
                id="destinationName"
                placeholder="e.g. Lab"
                error={!!errors.destinationName}
                {...register("destinationName")}
              />
            </FormField>
            <FormField
              id="distanceKm"
              label="Distance (km)"
              required
              error={errors.distanceKm?.message}
            >
              <FormInput
                id="distanceKm"
                type="number"
                step="any"
                min={0}
                error={!!errors.distanceKm}
                {...register("distanceKm")}
              />
            </FormField>
            <FormField
              id="transportMethodType"
              label="Transport method"
              required
              error={errors.transportMethodType?.message}
            >
              <FormSelect
                id="transportMethodType"
                options={transportMethodOptions}
                error={!!errors.transportMethodType}
                {...register("transportMethodType")}
              />
            </FormField>
            <FormField
              id="loadMassKg"
              label="Load mass (kg)"
              required
              error={errors.loadMassKg?.message}
              helperText="Mass moved on this leg. Required on every leg so the Certify aggregator can mass-weight distance (Transportation v1.1 §5)."
            >
              <FormInput
                id="loadMassKg"
                type="number"
                step="any"
                min={0}
                error={!!errors.loadMassKg}
                {...register("loadMassKg")}
              />
            </FormField>
          </div>
        </div>

        <div className="flex flex-col gap-16">
          <SectionLabel>Emissions calculation</SectionLabel>
          <FormField
            id="calculationMethodType"
            label="Calculation method"
            required
            error={errors.calculationMethodType?.message}
            helperText="Energy-usage is preferred (Isometric §3.2); distance-based is allowed when fuel data is unavailable."
          >
            <FormSelect
              id="calculationMethodType"
              options={calculationMethodOptions}
              error={!!errors.calculationMethodType}
              {...register("calculationMethodType")}
            />
          </FormField>

          {isEnergyUsage && (
            <div className="grid grid-cols-2 gap-16">
              <FormField
                id="fuelType"
                label="Fuel type"
                required
                error={errors.fuelType?.message}
              >
                <FormInput
                  id="fuelType"
                  placeholder="diesel, biodiesel, electricity…"
                  error={!!errors.fuelType}
                  {...register("fuelType")}
                />
              </FormField>
              <FormField
                id="fuelConsumedLiters"
                label="Fuel consumed (L)"
                error={errors.fuelConsumedLiters?.message}
                helperText="Provide this OR electricity (kWh)."
              >
                <FormInput
                  id="fuelConsumedLiters"
                  type="number"
                  step="any"
                  min={0}
                  error={!!errors.fuelConsumedLiters}
                  {...register("fuelConsumedLiters")}
                />
              </FormField>
              <FormField
                id="electricityKwh"
                label="Electricity used (kWh)"
                error={errors.electricityKwh?.message}
              >
                <FormInput
                  id="electricityKwh"
                  type="number"
                  step="any"
                  min={0}
                  error={!!errors.electricityKwh}
                  {...register("electricityKwh")}
                />
              </FormField>
            </div>
          )}

          {isDistanceBased && (
            <div className="grid grid-cols-2 gap-16">
              <FormField
                id="vehicleType"
                label="Vehicle type"
                required
                error={errors.vehicleType?.message}
              >
                <FormInput
                  id="vehicleType"
                  placeholder="e.g. Class 8 heavy-duty truck"
                  error={!!errors.vehicleType}
                  {...register("vehicleType")}
                />
              </FormField>
            </div>
          )}

          <div className="grid grid-cols-2 gap-16">
            <FormField
              id="emissionFactorUsed"
              label="Emission factor"
              required
              error={errors.emissionFactorUsed?.message}
              helperText="kg CO₂e per L, kWh, or t·km depending on method."
            >
              <FormInput
                id="emissionFactorUsed"
                type="number"
                step="any"
                error={!!errors.emissionFactorUsed}
                {...register("emissionFactorUsed")}
              />
            </FormField>
            <FormField
              id="emissionFactorSource"
              label="Emission factor source"
              error={errors.emissionFactorSource?.message}
              helperText="e.g. DEFRA 2024, IPCC AR6 Ch7."
            >
              <FormInput
                id="emissionFactorSource"
                error={!!errors.emissionFactorSource}
                {...register("emissionFactorSource")}
              />
            </FormField>
            <FormField
              id="transportEmissionsCo2eKg"
              label="Computed emissions (kg CO₂e)"
              error={errors.transportEmissionsCo2eKg?.message}
              helperText="Optional. Auto-computed downstream; record here if pre-computed."
            >
              <FormInput
                id="transportEmissionsCo2eKg"
                type="number"
                step="any"
                error={!!errors.transportEmissionsCo2eKg}
                {...register("transportEmissionsCo2eKg")}
              />
            </FormField>
          </div>
        </div>

        <div className="flex flex-col gap-16">
          <SectionLabel>Documentation (optional)</SectionLabel>
          <div className="grid grid-cols-2 gap-16">
            <FormField
              id="billOfLading"
              label="Bill of lading"
              error={errors.billOfLading?.message}
            >
              <FormInput
                id="billOfLading"
                error={!!errors.billOfLading}
                {...register("billOfLading")}
              />
            </FormField>
            <FormField
              id="weighScaleTicketRef"
              label="Weigh-scale ticket"
              error={errors.weighScaleTicketRef?.message}
            >
              <FormInput
                id="weighScaleTicketRef"
                error={!!errors.weighScaleTicketRef}
                {...register("weighScaleTicketRef")}
              />
            </FormField>
          </div>
        </div>

        <FormActions
          onCancel={onClose}
          isSubmitting={
            isSubmitting || createMutation.isPending || updateMutation.isPending
          }
          submitLabel={isEditMode ? "Save changes" : "Add transport leg"}
        />
      </form>
    </dialog>
  );
}
