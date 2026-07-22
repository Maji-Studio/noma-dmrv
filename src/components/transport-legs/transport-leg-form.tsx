"use client";

import type { FormEventHandler, ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  DistanceCalcField,
  FormActions,
  FormField,
  FormInput,
  FormSection,
  FormSelect,
  PositionPicker,
  ServerError,
  makeCertFieldStatus,
  resolveCertFieldStatus,
} from "@/components/forms";
import {
  transportLegFormSchema,
  selectableTransportMethods,
  type TransportLegFormData,
  type TransportMethodValue,
} from "@/schemas/transport-legs";
import {
  DISTANCE_SOURCE_LABELS,
  type DistanceSourceValue,
} from "@/schemas/distance-source";
import { DEFAULT_TRIP_TYPE, TRIP_TYPE_OPTIONS } from "@/schemas/trip-type";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import type { TransportLeg } from "@/db/schema";
import { TransportEvidencePanel } from "./transport-evidence-documents";
import { hasDocumentBackedDistanceProvenance } from "@/lib/certification/transport-evidence";

interface TransportLegFormProps {
  /** When provided, the form edits this leg; otherwise it creates a new one. */
  leg?: TransportLeg | TransportLegFormData | null;
  onSubmit: (data: TransportLegFormData) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
  /** Render without a nested form when an owning parent form surrounds this UI. */
  embedded?: boolean;
}

interface TransportLegFormContainerProps {
  embedded: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}

function TransportLegFormContainer({
  embedded,
  onSubmit,
  children,
}: TransportLegFormContainerProps) {
  const className = "flex flex-col gap-20";
  return embedded ? (
    <div className={className}>{children}</div>
  ) : (
    <form onSubmit={onSubmit} className={className}>
      {children}
    </form>
  );
}

const transportMethodOptions = selectableTransportMethods.map((m) => ({
  value: m,
  label: m.charAt(0).toUpperCase() + m.slice(1),
}));

const MIN_LOAD_MASS_KG = 0.000001;
const isTransportLegCertifyField = (field: string) =>
  isCertifyFormField("transportLeg", field);

function isSavedTransportLeg(
  leg: TransportLeg | TransportLegFormData,
): leg is TransportLeg {
  return "id" in leg;
}

function legToFormDefaults(
  leg: TransportLeg | TransportLegFormData | null | undefined,
) {
  return {
    originGpsLatitude: leg?.originGpsLatitude ?? null,
    originGpsLongitude: leg?.originGpsLongitude ?? null,
    originName: leg?.originName ?? "",
    destinationGpsLatitude: leg?.destinationGpsLatitude ?? null,
    destinationGpsLongitude: leg?.destinationGpsLongitude ?? null,
    destinationName: leg?.destinationName ?? "",
    distanceKm: leg?.distanceKm ?? undefined,
    distanceSource: (leg?.distanceSource ?? "manual") as DistanceSourceValue,
    transportMethodType: (leg?.transportMethodType ??
      "road") as TransportMethodValue,
    vehicleType: leg?.vehicleType ?? "",
    modelYear: leg?.modelYear ?? null,
    loadMassKg: leg?.loadMassKg ?? null,
    tripType: leg?.tripType ?? DEFAULT_TRIP_TYPE,
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
  embedded = false,
}: TransportLegFormProps) {
  const isEditMode = !!leg;
  const isPersisted = !!leg && isSavedTransportLeg(leg);
  const defaultValues = legToFormDefaults(leg);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(transportLegFormSchema),
    defaultValues,
  });
  const certStatus = makeCertFieldStatus(isPersisted ? defaultValues : undefined);

  // Provenance: hand-editing the distance reverts a CALC'd map estimate to
  // manual — the operator can explicitly re-mark it as document-backed.
  const distanceSource = useWatch({
    control,
    name: "distanceSource",
  }) as DistanceSourceValue;
  const distanceSourceOptions = (
    distanceSource === "map_estimate"
      ? (["map_estimate", "manual", "document"] as const)
      : (["manual", "document"] as const)
  ).map((value) => ({ value, label: DISTANCE_SOURCE_LABELS[value] }));

  // CALC endpoints: this leg's own origin/destination pickers.
  const originLat = useWatch({ control, name: "originGpsLatitude" }) as number | null | undefined;
  const originLng = useWatch({ control, name: "originGpsLongitude" }) as number | null | undefined;
  const destinationLat = useWatch({ control, name: "destinationGpsLatitude" }) as number | null | undefined;
  const destinationLng = useWatch({ control, name: "destinationGpsLongitude" }) as number | null | undefined;
  const distanceKm = useWatch({ control, name: "distanceKm" }) as number | null | undefined;

  const originPoint =
    originLat != null && originLng != null ? { lat: originLat, lng: originLng } : null;
  const destinationPoint =
    destinationLat != null && destinationLng != null
      ? { lat: destinationLat, lng: destinationLng }
      : null;

  const submit = handleSubmit(async (data) => {
    await onSubmit(data as TransportLegFormData);
  });

  return (
    <TransportLegFormContainer embedded={embedded} onSubmit={submit}>
      {errors.root?.serverError?.message && (
        <ServerError message={errors.root.serverError.message} />
      )}

      <FormSection
        title="Route"
        divider={false}
        hint="We record distance and cargo mass; Isometric applies the transport emissions factor."
      >
        <div className="flex flex-col gap-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
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
          </div>

          {/* Origin/destination maps stack full-width — side-by-side cramps
              each preview, search box, and the lat/lng pair. */}
          <PositionPicker
            idPrefix="origin"
            label="Origin position"
            accent="orange"
            latitude={originLat ?? null}
            longitude={originLng ?? null}
            onPositionChange={({ lat, lng }) => {
              setValue("originGpsLatitude", lat, { shouldDirty: true, shouldValidate: true });
              setValue("originGpsLongitude", lng, { shouldDirty: true, shouldValidate: true });
            }}
            latitudeError={errors.originGpsLatitude?.message}
            longitudeError={errors.originGpsLongitude?.message}
            disabled={isSubmitting}
          />
          <PositionPicker
            idPrefix="destination"
            label="Destination position"
            accent="pink"
            latitude={destinationLat ?? null}
            longitude={destinationLng ?? null}
            onPositionChange={({ lat, lng }) => {
              setValue("destinationGpsLatitude", lat, { shouldDirty: true, shouldValidate: true });
              setValue("destinationGpsLongitude", lng, { shouldDirty: true, shouldValidate: true });
            }}
            latitudeError={errors.destinationGpsLatitude?.message}
            longitudeError={errors.destinationGpsLongitude?.message}
            disabled={isSubmitting}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
          <DistanceCalcField
            id="distanceKm"
            label="Distance (km)"
            required
            certifyRequired={isTransportLegCertifyField("distanceKm")}
            certifyStatus={certStatus("distanceKm")}
            error={errors.distanceKm?.message}
            disabled={isSubmitting}
            // The provenance select next to this field is the source UI.
            showSourceBadge={false}
            distanceKm={distanceKm}
            distanceSource={distanceSource}
            onDistanceChange={(km, source) => {
              setValue("distanceKm", km ?? undefined, {
                shouldDirty: true,
                shouldValidate: true,
              });
              // CALC always claims map_estimate; a hand edit only degrades a
              // map estimate — an explicit Document/Manual marking survives.
              if (source === "map_estimate" || distanceSource === "map_estimate") {
                setValue("distanceSource", source ?? "manual", { shouldDirty: true });
              }
            }}
            origin={originPoint}
            destination={destinationPoint}
            originLabel="origin position"
            destinationLabel="destination position"
          />
          <FormField
            id="distanceSource"
            label="Distance source"
            error={errors.distanceSource?.message}
            helperText="Use Document when the distance comes from shipping evidence."
            certifyRequired={isTransportLegCertifyField("distanceSource")}
            certifyStatus={resolveCertFieldStatus(
              isPersisted ? true : undefined,
              hasDocumentBackedDistanceProvenance(defaultValues.distanceSource),
            )}
          >
            <FormSelect
              id="distanceSource"
              options={distanceSourceOptions}
              error={!!errors.distanceSource}
              {...register("distanceSource")}
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
            id="tripType"
            label="Trip type"
            error={errors.tripType?.message}
            helperText="Return doubles the distance (vehicle returns empty). Choose One-way only with an evidenced onward destination."
          >
            <FormSelect
              id="tripType"
              options={TRIP_TYPE_OPTIONS}
              disabled={isSubmitting}
              error={!!errors.tripType}
              {...register("tripType")}
            />
          </FormField>
          <FormField
            id="loadMassKg"
            label="Load mass (kg)"
            required
            error={errors.loadMassKg?.message}
            helperText="Mass moved on this leg. Used to weight transport emissions."
            certifyRequired={isTransportLegCertifyField("loadMassKg")}
            certifyStatus={certStatus("loadMassKg")}
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
      </FormSection>

      <FormSection title="Documentation">
        <p className="body-small text-[var(--color-text-secondary)]">
          Classify each supporting file before upload. One accepted transport
          evidence file is sufficient.
        </p>
        {isEditMode && leg && isSavedTransportLeg(leg) ? (
          <TransportEvidencePanel
            entityType="transport_leg"
            entityId={leg.id}
            distanceSource={leg.distanceSource}
          />
        ) : (
          <p className="body-small text-[var(--color-text-tertiary)] border border-dashed border-[var(--color-border-secondary)] px-12 py-16">
            Save the leg first, then re-open it to attach classified transport
            evidence.
          </p>
        )}
      </FormSection>

      <FormActions
        sticky={false}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={isEditMode ? "Save changes" : "Add transport leg"}
        submitType={embedded ? "button" : "submit"}
        onSubmitClick={embedded ? () => void submit() : undefined}
      />
    </TransportLegFormContainer>
  );
}
