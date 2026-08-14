/**
 * Supplier Quick Add Dialog
 * Inline dialog for creating a supplier from an EntitySelect dropdown.
 * Collects only the supplier and required initial source-location fields.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormActions } from "@/components/forms/form-actions";
import { FormField } from "@/components/forms/form-field";
import { FormInput } from "@/components/forms/form-input";
import { PositionPicker } from "@/components/forms/position-picker";
import { ResolvedErrorRevalidator } from "@/components/forms/resolved-error-revalidator";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { useCreateSupplierWithLocations } from "@/hooks/use-suppliers";
import { resolveLocationCountry } from "@/lib/location-defaults";
import {
  type CreateSupplierWithLocationsData,
  supplierQuickAddSchema,
  type SupplierQuickAddData,
  type SupplierQuickAddInput,
} from "@/schemas/suppliers";
import { ENTITY_TYPE_LABELS } from "./entity-labels";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface SupplierQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

export function SupplierQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: SupplierQuickAddDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const activePayloadRef = useRef<CreateSupplierWithLocationsData | null>(null);
  const { defaults: organizationDefaults } = useOrganizationDefaultValues();
  const defaultCountry = resolveLocationCountry(
    undefined,
    organizationDefaults.defaultCountry,
  );
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setValue,
    trigger,
  } = useForm<SupplierQuickAddInput, unknown, SupplierQuickAddData>({
    resolver: zodResolver(supplierQuickAddSchema),
    defaultValues: {
      name: "",
      country: defaultCountry,
      gpsLatitude: undefined,
      gpsLongitude: undefined,
    },
  });
  const gpsLatitude = useWatch({
    control,
    name: "gpsLatitude",
  }) as number | null | undefined;
  const gpsLongitude = useWatch({
    control,
    name: "gpsLongitude",
  }) as number | null | undefined;
  const createSupplier = useCreateSupplierWithLocations({
    onSuccess: (supplier, variables) => {
      if (variables !== activePayloadRef.current) return;
      activePayloadRef.current = null;
      onSuccess({
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        subtitle: supplier.location ?? undefined,
      });
      onClose();
    },
    onError: (cause, variables) => {
      if (variables !== activePayloadRef.current) return;
      activePayloadRef.current = null;
      setError(cause.message);
    },
  });

  const submitSupplier = async (data: SupplierQuickAddData) => {
    setError(null);
    const payload: CreateSupplierWithLocationsData = {
      supplier: { name: data.name },
      locations: [
        {
          country: data.country,
          gpsLatitude: data.gpsLatitude,
          gpsLongitude: data.gpsLongitude,
          isDefault: true,
        },
      ],
    };

    try {
      activePayloadRef.current = payload;
      await createSupplier.mutateAsync(payload);
    } catch {
      // The mutation callback owns the operator-facing error state.
    }
  };

  const handleOpen = () => {
    activePayloadRef.current = null;
    setError(null);
    reset({
      name: "",
      country: defaultCountry,
      gpsLatitude: undefined,
      gpsLongitude: undefined,
    });
  };

  const handleClose = () => {
    activePayloadRef.current = null;
    onClose();
  };

  const entityLabel = ENTITY_TYPE_LABELS.supplier;

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={handleClose}
      onOpen={handleOpen}
      title={`New ${entityLabel}`}
      testId="supplier-quick-add-dialog"
      dismissOnClickOutside={false}
      dismissible={!createSupplier.isPending}
    >
      <form
        onSubmit={(event) => {
          event.stopPropagation();
          return handleSubmit(submitSupplier)(event);
        }}
        className="space-y-20"
      >
        <ResolvedErrorRevalidator control={control} trigger={trigger} />

        <FormField
          id="supplier-quick-add-name"
          label="Supplier name"
          error={errors.name?.message}
          required
        >
          <FormInput
            id="supplier-quick-add-name"
            type="text"
            disabled={createSupplier.isPending}
            error={!!errors.name}
            {...register("name")}
          />
        </FormField>

        <FormField
          id="supplier-quick-add-country"
          label="Country"
          error={errors.country?.message}
          required
        >
          <FormInput
            id="supplier-quick-add-country"
            type="text"
            placeholder="e.g., Tanzania"
            disabled={createSupplier.isPending}
            error={!!errors.country}
            {...register("country")}
          />
        </FormField>

        <PositionPicker
          idPrefix="supplier-quick-add-position"
          label="Source location position"
          accent="orange"
          required
          latitude={gpsLatitude}
          longitude={gpsLongitude}
          onPositionChange={({ lat, lng }) => {
            setValue("gpsLatitude", lat ?? undefined, {
              shouldDirty: true,
              shouldValidate: true,
            });
            setValue("gpsLongitude", lng ?? undefined, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
          latitudeError={errors.gpsLatitude?.message}
          longitudeError={errors.gpsLongitude?.message}
          disabled={createSupplier.isPending}
        />

        <FormActions
          control={control}
          onCancel={handleClose}
          isSubmitting={createSupplier.isPending}
          errorMessage={error ?? undefined}
          submitLabel={`Create ${entityLabel}`}
          sticky={false}
        />
      </form>
    </QuickAddDialogShell>
  );
}
