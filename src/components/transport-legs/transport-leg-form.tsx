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
  transportLegFormSchema,
  transportMethods,
  type TransportEntityTypeValue,
  type TransportMethodValue,
} from "@/schemas/transport-legs";
import {
  useCreateTransportLeg,
  useUpdateTransportLeg,
} from "@/hooks/use-transport-legs";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import type { TransportLeg } from "@/db/schema";

interface TransportLegFormProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** When provided, the form edits this leg; otherwise it creates a new one. */
  leg?: TransportLeg | null;
}

const transportMethodOptions = transportMethods.map((m) => ({
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

  const onSubmit = handleSubmit(async (data) => {
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
            Distance-based leg: we record distance + cargo mass; Isometric
            applies the emission factor (Transportation v1.1 Eq. 3).
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
            Verification evidence (Transportation v1.1 §6) — optional, attachable
            later.
          </p>
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
