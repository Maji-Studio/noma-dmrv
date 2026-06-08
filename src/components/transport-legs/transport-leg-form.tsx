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
import {
  transportLegFormSchema,
  selectableTransportMethods,
  type TransportLegFormData,
  type TransportMethodValue,
} from "@/schemas/transport-legs";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import type { TransportLeg } from "@/db/schema";
import { TransportLegDocuments } from "./transport-leg-documents";

interface TransportLegFormProps {
  /** When provided, the form edits this leg; otherwise it creates a new one. */
  leg?: TransportLeg | null;
  onSubmit: (data: TransportLegFormData) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const transportMethodOptions = selectableTransportMethods.map((m) => ({
  value: m,
  label: m.charAt(0).toUpperCase() + m.slice(1),
}));

const MIN_LOAD_MASS_KG = 0.000001;
const isTransportLegCertifyField = (field: string) =>
  isCertifyFormField("transportLeg", field);

function legToFormDefaults(leg: TransportLeg | null | undefined) {
  return {
    originGpsLatitude: leg?.originGpsLatitude ?? null,
    originGpsLongitude: leg?.originGpsLongitude ?? null,
    originName: leg?.originName ?? "",
    destinationGpsLatitude: leg?.destinationGpsLatitude ?? null,
    destinationGpsLongitude: leg?.destinationGpsLongitude ?? null,
    destinationName: leg?.destinationName ?? "",
    distanceKm: leg?.distanceKm ?? undefined,
    transportMethodType: (leg?.transportMethodType ??
      "road") as TransportMethodValue,
    vehicleType: leg?.vehicleType ?? "",
    modelYear: leg?.modelYear ?? null,
    loadMassKg: leg?.loadMassKg ?? null,
    calculationMethodType: "distance_based" as const,
    billOfLading: leg?.billOfLading ?? "",
    weighScaleTicketRef: leg?.weighScaleTicketRef ?? "",
  };
}

/**
 * Inline transport-leg form (matches the production-run child-entity pattern).
 * The parent editor owns the create/update mutations and renders this in a box;
 * the form just validates and calls `onSubmit`.
 */
export function TransportLegForm({
  leg,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: TransportLegFormProps) {
  const isEditMode = !!leg;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(transportLegFormSchema),
    defaultValues: legToFormDefaults(leg),
  });

  const submit = handleSubmit(async (data) => {
    await onSubmit(data as TransportLegFormData);
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-24">
      <p className="body-small text-[var(--color-text-secondary)]">
        Distance-based leg: we record distance + cargo mass; Isometric applies the
        emission factor (Transportation v1.1 Eq. 3).
      </p>

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
              placeholder="e.g. Storage yard"
              error={!!errors.destinationName}
              {...register("destinationName")}
            />
          </FormField>
          <FormField
            id="distanceKm"
            label="Distance (km)"
            required
            error={errors.distanceKm?.message}
            certifyRequired={isTransportLegCertifyField("distanceKm")}
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
            helperText="Cargo mass moved on this leg (Eq. 3, W_j). Required so the Certify aggregator can mass-weight distance."
            certifyRequired={isTransportLegCertifyField("loadMassKg")}
          >
            <FormInput
              id="loadMassKg"
              type="number"
              step="any"
              min={MIN_LOAD_MASS_KG}
              error={!!errors.loadMassKg}
              {...register("loadMassKg")}
            />
          </FormField>
          <FormField
            id="vehicleType"
            label="Vehicle type"
            error={errors.vehicleType?.message}
            helperText="Selects the Isometric component emission factor."
          >
            <FormInput
              id="vehicleType"
              placeholder="e.g. Class 8 heavy-duty truck"
              error={!!errors.vehicleType}
              {...register("vehicleType")}
            />
          </FormField>
        </div>
      </div>

      <div className="flex flex-col gap-16">
        <SectionLabel>Documentation</SectionLabel>
        <p className="body-small text-[var(--color-text-secondary)]">
          Verification evidence (Transportation v1.1 §6) — bill of lading and
          weigh-scale ticket.
        </p>
        {isEditMode && leg ? (
          <TransportLegDocuments legId={leg.id} />
        ) : (
          <p className="body-small text-[var(--color-text-tertiary)] border border-dashed border-[var(--color-border-secondary)] px-12 py-16">
            Save the leg first, then re-open it to attach the bill of lading and
            weigh-scale ticket.
          </p>
        )}
      </div>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={isEditMode ? "Save changes" : "Add transport leg"}
      />
    </form>
  );
}
