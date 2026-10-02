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
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr";
import { useForm } from "react-hook-form";
import {
  ChoiceCardGroup,
  FormActions,
  FormField,
  FormInput,
  FormSection,
  FormSelect,
  SegmentedControl,
  ServerError,
} from "@/components/forms";
import { EmptyState } from "@/components/ui";
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
import {
  APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS,
  formatApplicationEvidenceMethod,
  isSelectableApplicationEvidenceMethod,
  selectableApplicationEvidenceMethods,
} from "@/schemas/applications";
import { timezones, type Timezone } from "@/schemas/facilities";
import { packagingTypes, type PackagingType } from "@/schemas/orders";
import {
  organizationSettingsFormSchema,
  type OrganizationSettingsInput,
  type OrganizationSettingsValues,
} from "@/schemas/organization-settings";
import { useState } from "react";
import { EVIDENCE_METHOD_ART } from "@/components/applications";

const TIMEZONE_OPTIONS = timezones.map((zone) => ({
  value: zone,
  label: formatTimezoneLabel(zone),
}));

// A default evidence method decides which evidence every new application asks
// for, so it is a card choice with its consequence spelled out.
const EVIDENCE_METHOD_OPTIONS = selectableApplicationEvidenceMethods.map((method) => ({
  value: method,
  title: formatApplicationEvidenceMethod(method),
  description: APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS[method],
  art: EVIDENCE_METHOD_ART[method],
}));

const PACKAGING_LABELS: Record<PackagingType, string> = {
  loose: "Loose",
  bagged: "Bagged",
};

const PACKAGING_OPTIONS = packagingTypes.map((type) => ({
  value: type,
  label: PACKAGING_LABELS[type],
}));

function isOfferedTimezone(zone: string): zone is Timezone {
  return (timezones as readonly string[]).includes(zone);
}

export function OrganizationDefaultsForm() {
  const { activeOrganizationId } = useFacilityContext();
  const query = useOrganizationDefaults(activeOrganizationId);

  if (query.isLoading && !query.data) {
    return <Skeleton className="h-320 w-full" />;
  }

  if (!query.data) {
    return (
      <ServerError message="Couldn't load the operating defaults. Refresh the page to retry." />
    );
  }

  const { defaults, viewerCanManage } = query.data;

  if (!viewerCanManage) {
    return (
      <EmptyState
        icon={<SlidersHorizontalIcon size={32} />}
        title="Only Organization Owners and Admins can change operating defaults"
        description="Ask one to make changes."
        padding="sm"
      />
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
    control,
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
      defaultEvidenceMethod: isSelectableApplicationEvidenceMethod(
        defaults.defaultEvidenceMethod,
      )
        ? defaults.defaultEvidenceMethod
        : "location",
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
          : "The operating defaults were not saved. Try again.",
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-preview flex flex-col gap-24"
    >
      <FormSection title="Region" divider={false}>
        <div className="grid grid-cols-1 gap-x-16 gap-y-16 sm:grid-cols-2">
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
          cue="Seeds new facilities. Existing facilities keep their own."
          hint="A facility's timezone decides which day a Sample or production run is attributed to. Set it before adding records."
        >
          <FormSelect
            id="default-timezone"
            options={TIMEZONE_OPTIONS}
            error={!!errors.defaultTimezone}
            {...register("defaultTimezone")}
          />
        </FormField>
        </div>
      </FormSection>

      <FormSection title="New records">
        <FormField
          id="default-evidence-method"
          label="Application evidence"
          error={errors.defaultEvidenceMethod?.message}
          helperText="Seeds new applications."
        >
          <ChoiceCardGroup
            id="default-evidence-method"
            legend="Application evidence"
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
          <SegmentedControl
            id="default-packaging"
            legend="Order packaging"
            options={PACKAGING_OPTIONS}
            error={!!errors.defaultPackaging}
            {...register("defaultPackaging")}
          />
        </FormField>
      </FormSection>

      <p className="body-caption text-[var(--color-text-tertiary)]">
        These only seed new records. Nothing already saved changes.
      </p>

      <FormActions
        control={control}
        isSubmitting={saveMutation.isPending}
        errorMessage={serverError}
        submitLabel="Save defaults"
        submittingLabel="Saving…"
        sticky={false}
      />
    </form>
  );
}
