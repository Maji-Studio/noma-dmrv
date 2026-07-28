/**
 * OrganizationDefaultsForm — the organization's operating defaults.
 *
 * Every field here seeds a form field somewhere else and nothing more: the
 * per-record value stays editable, and changing a default never rewrites a
 * saved record. That is the whole contract, and the helper text on each field
 * says which record it seeds, because a settings field whose consequence is
 * invisible is one an operator cannot reason about.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  FormActions,
  FormField,
  FormInput,
  FormSelect,
} from "@/components/forms";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_ORGANIZATION_TIMEZONE,
  type OrganizationDefaults,
} from "@/config/organization-settings";
import {
  useOrganizationDefaults,
  useSaveOrganizationDefaults,
} from "@/hooks/use-organization-settings";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { currencyCodes } from "@/schemas/credit-batches";
import { timezones, type Timezone } from "@/schemas/facilities";
import {
  organizationSettingsFormSchema,
  type OrganizationSettingsInput,
  type OrganizationSettingsValues,
} from "@/schemas/organization-settings";
import { TRIP_TYPE_OPTIONS } from "@/schemas/trip-type";
import { useState } from "react";

const CURRENCY_OPTIONS = currencyCodes.map((code) => ({
  value: code,
  label: code,
}));

const TIMEZONE_OPTIONS = timezones.map((zone) => ({
  value: zone,
  label: formatTimezoneLabel(zone),
}));

const EVIDENCE_METHOD_OPTIONS = [
  { value: "visual", label: "Visual" },
  { value: "boundary", label: "GIS boundary" },
] as const;

const PACKAGING_OPTIONS = [
  { value: "loose", label: "Loose" },
  { value: "bagged", label: "Bagged" },
] as const;

function isOfferedTimezone(zone: string): zone is Timezone {
  return (timezones as readonly string[]).includes(zone);
}

export function OrganizationDefaultsForm() {
  const { activeOrganizationId } = useFacilityContext();
  const query = useOrganizationDefaults(activeOrganizationId);

  if (query.isLoading) {
    return <Skeleton className="h-320 w-full" />;
  }

  if (query.error || !query.data) {
    return (
      <p className="body-medium text-[var(--st-bad)]" role="alert">
        Couldn&apos;t load the operating defaults. Refresh the page to retry.
      </p>
    );
  }

  const { defaults, viewerCanManage } = query.data;

  if (!viewerCanManage) {
    return (
      <p className="body-medium text-[var(--color-text-secondary)]">
        Organization Owners and Admins set the operating defaults.
      </p>
    );
  }

  // Keyed on the loaded values: react-hook-form reads `defaultValues` once, so
  // a remount is how saved values reach the inputs.
  return <DefaultsForm key={JSON.stringify(defaults)} defaults={defaults} />;
}

function DefaultsForm({ defaults }: { defaults: OrganizationDefaults }) {
  const toast = useToast();
  const saveMutation = useSaveOrganizationDefaults();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrganizationSettingsInput, unknown, OrganizationSettingsValues>({
    resolver: zodResolver(organizationSettingsFormSchema),
    defaultValues: {
      ...defaults,
      // The country input holds a string; null is the stored "not said".
      defaultCountry: defaults.defaultCountry ?? "",
      // The column is free text, so a stored zone the picker does not offer
      // (a seed, a hand-edited row) would leave the select on its first option
      // and silently save that. Fall back explicitly instead.
      defaultTimezone: isOfferedTimezone(defaults.defaultTimezone)
        ? defaults.defaultTimezone
        : DEFAULT_ORGANIZATION_TIMEZONE,
    },
  });

  async function onSubmit(values: OrganizationSettingsValues) {
    setServerError("");
    try {
      await saveMutation.mutateAsync(values);
      toast.success("Operating defaults saved.");
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Failed to save the operating defaults.",
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-preview flex flex-col gap-24"
    >
      <div className="grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2">
        <FormField
          id="default-currency"
          label="Currency"
          error={errors.defaultCurrency?.message}
          // Orders only. Credit batches have a currency column but no form
          // field for it, so claiming this seeds them would be false.
          helperText="Seeds new orders."
        >
          <FormSelect
            id="default-currency"
            options={CURRENCY_OPTIONS}
            error={!!errors.defaultCurrency}
            {...register("defaultCurrency")}
          />
        </FormField>

        <FormField
          id="default-country"
          label="Country"
          error={errors.defaultCountry?.message}
          helperText="Seeds new facilities, suppliers and customers."
        >
          <FormInput
            id="default-country"
            type="text"
            placeholder="e.g., Tanzania"
            error={!!errors.defaultCountry}
            {...register("defaultCountry")}
          />
        </FormField>

        <FormField
          id="default-timezone"
          label="Timezone"
          error={errors.defaultTimezone?.message}
          helperText="Seeds new facilities. Existing facilities keep their own."
          hint="A facility's timezone decides which day a sample or production run is attributed to, so it is worth getting right before records exist rather than after."
        >
          <FormSelect
            id="default-timezone"
            options={TIMEZONE_OPTIONS}
            error={!!errors.defaultTimezone}
            {...register("defaultTimezone")}
          />
        </FormField>

        <FormField
          id="default-trip-type"
          label="Transport trip type"
          error={errors.defaultTripType?.message}
          helperText="Seeds new deliveries, feedstock hauls and transport legs."
          hint="A return trip counts the distance twice in emissions accounting, which is the conservative protocol default. Choose one-way only if your hauls have an evidenced onward destination — and the per-leg field stays editable either way."
        >
          <FormSelect
            id="default-trip-type"
            options={TRIP_TYPE_OPTIONS}
            error={!!errors.defaultTripType}
            {...register("defaultTripType")}
          />
        </FormField>

        <FormField
          id="default-evidence-method"
          label="Application evidence"
          error={errors.defaultEvidenceMethod?.message}
          helperText="Seeds new applications."
        >
          <FormSelect
            id="default-evidence-method"
            options={EVIDENCE_METHOD_OPTIONS}
            error={!!errors.defaultEvidenceMethod}
            {...register("defaultEvidenceMethod")}
          />
        </FormField>

        <FormField
          id="default-packaging"
          label="Order packaging"
          error={errors.defaultPackaging?.message}
          helperText="Seeds new orders."
        >
          <FormSelect
            id="default-packaging"
            options={PACKAGING_OPTIONS}
            error={!!errors.defaultPackaging}
            {...register("defaultPackaging")}
          />
        </FormField>
      </div>

      <p className="body-caption text-[var(--color-text-tertiary)]">
        These only seed new records. Nothing already saved changes.
      </p>

      <FormActions
        isSubmitting={saveMutation.isPending}
        errorMessage={serverError}
        submitLabel="Save defaults"
        submittingLabel="Saving…"
        sticky={false}
      />
    </form>
  );
}
