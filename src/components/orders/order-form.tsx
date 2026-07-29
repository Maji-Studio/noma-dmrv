/**
 * OrderForm component
 * Reusable order form with React Hook Form integration
 */
"use client";

import { numericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, StorefrontIcon, PackageIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormEntitySelect, FormActions, FormSection, FormSpine } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import {
  orderFormSchema,
  packagingTypes,
  type OrderFormData,
  type PackagingType,
} from "@/schemas/orders";
import type { Order } from "@/db/schema";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { useCustomers, useCustomerLocations } from "@/hooks/use-customers";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";
import { CustomerLocationDetails } from "./customer-location-details";
import { useEffect } from "react";

// ============================================
// Constants for select options
// ============================================

const packagingOptions: readonly { value: string; label: string }[] =
  packagingTypes.map((type) => ({
    value: type,
    label: formatPackaging(type),
  }));

// ============================================
// Formatting helpers
// ============================================

function formatPackaging(type: PackagingType): string {
  const labels: Record<PackagingType, string> = {
    loose: "Loose",
    bagged: "Bagged",
  };
  return labels[type];
}

// ============================================
// Component
// ============================================

interface OrderFormProps {
  /** Existing order data for editing (undefined for create mode) */
  order?: Order;
  /** Form submission handler */
  onSubmit: (data: OrderFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function OrderForm({
  order,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: OrderFormProps) {
  const isEditMode = !!order;
  const { facilityId: contextFacilityId, facilities } = useFacilityContext();
  // Organization operating defaults seed create mode only; an existing record
  // always wins. Warmed once per session in FacilityProvider, so this is a
  // cache read rather than a round trip on open.
  const { defaults: orgDefaults } = useOrganizationDefaultValues();


  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(orderFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues: {
      facilityId: order?.facilityId ?? contextFacilityId ?? "",
      customerId: order?.customerId ?? "",
      customerLocationId: order?.customerLocationId ?? "",
      biocharProductId: order?.biocharProductId ?? "",
      orderDate: order?.orderDate
        ? formatLocalDate(new Date(order.orderDate))
        : formatLocalDate(new Date()),
      quantityKg: order?.quantityKg ?? undefined,
      packaging:
        (order?.packaging as PackagingType) ?? orgDefaults.defaultPackaging,
      value: order?.value ?? undefined,
      currency: order?.currency ?? orgDefaults.defaultCurrency,
    },
  });

  const watchedCustomerId = useWatch({ control, name: "customerId" });
  const selectedCustomerId = watchedCustomerId || undefined;
  const watchedLocationId = useWatch({ control, name: "customerLocationId" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });

  // Fetch related data for dropdowns
  const { data: customersData } = useCustomers({ pageSize: 100 });
  const { data: customerLocationsData } = useCustomerLocations(
    selectedCustomerId ?? "",
    !!selectedCustomerId
  );

  const customers = customersData?.items ?? [];

  // Get customer locations for selected customer
  const customerLocations = customerLocationsData ?? [];

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const locationOptions = customerLocations.map((l: { id: string; name: string | null }) => ({
    value: l.id,
    label: l.name ?? "Unnamed location",
  }));

  // Details panel data for the selected location (issue #196). The facility
  // resolves from the form's own facilityId so edit mode shows the order's
  // facility even when the global selector points elsewhere.
  const selectedLocation = watchedLocationId
    ? customerLocations.find((l) => l.id === watchedLocationId)
    : undefined;
  const formFacility = facilities.find((f) => f.id === watchedFacilityId);

  // Sync facilityId when contextFacilityId arrives after mount (create mode only)
  useEffect(() => {
    if (!order?.facilityId && contextFacilityId) {
      const currentValue = getValues("facilityId");
      if (!currentValue) {
        setValue("facilityId", contextFacilityId);
      }
    }
  }, [contextFacilityId, order?.facilityId, setValue, getValues]);

  // Clear stale location when customer changes (skips initial mount so
  // edit-mode defaults survive)
  useClearOnDependencyChange(watchedCustomerId, () =>
    setValue("customerLocationId", "")
  );

  // Auto-select location when customer has exactly one
  useEffect(() => {
    if (customerLocationsData?.length === 1 && !getValues("customerLocationId")) {
      setValue("customerLocationId", customerLocationsData[0].id);
    }
  }, [customerLocationsData, setValue, getValues]);

  const defaultSubmitLabel = isEditMode ? "Update Order" : "Create Order";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as OrderFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <FormSpine control={control}>
      {/* Order Information */}
      <FormSection
        title="Order information"
        icon={<CalendarIcon size={14} weight="bold" />}
        fields={["orderDate"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="orderDate"
            label="Order date"
            error={errors.orderDate?.message}
            required
          >
            <FormInput
              id="orderDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.orderDate}
              {...register("orderDate")}
            />
          </FormField>

        </div>
      </FormSection>

      {/* Customer Section */}
      <FormSection
        title="Customer details"
        icon={<StorefrontIcon size={14} weight="bold" />}
        fields={["customerId", "customerLocationId"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="customerId"
            label="Customer"
            error={errors.customerId?.message}
            required
          >
            <FormSelect
              id="customerId"
              placeholder="Select customer..."
              disabled={isSubmitting}
              error={!!errors.customerId}
              options={customerOptions}
              {...register("customerId")}
            />
          </FormField>

          <FormField
            id="customerLocationId"
            label="Customer location"
            error={errors.customerLocationId?.message}
          >
            <FormSelect
              id="customerLocationId"
              placeholder={
                selectedCustomerId
                  ? "Select location..."
                  : "Select a customer first"
              }
              disabled={isSubmitting || !selectedCustomerId}
              error={!!errors.customerLocationId}
              options={locationOptions}
              {...register("customerLocationId")}
            />
          </FormField>
        </div>

        {selectedLocation && (
          <CustomerLocationDetails
            location={selectedLocation}
            facility={formFacility}
          />
        )}
      </FormSection>

      {/* Product Section */}
      <FormSection
        title="Product details"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={["biocharProductId", "packaging", "quantityKg", "value", "currency"]}
      >
        <FormEntitySelect
          control={control}
          name="biocharProductId"
          label="Product bin"
          entityType="biocharProduct"
          placeholder="Select product bin..."
          required
          disabled={isSubmitting}
          filterBy={contextFacilityId ? { facilityId: contextFacilityId } : undefined}
          emptyHint={{
            message:
              "No product bin contains a biochar product. Create one from a completed production run first.",
            href: contextFacilityId
              ? `/biochar-products?facility=${encodeURIComponent(contextFacilityId)}`
              : "/biochar-products",
            linkLabel: "Open biochar products",
          }}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="packaging"
            label="Packaging"
            error={errors.packaging?.message}
            required
          >
            <FormSelect
              id="packaging"
              disabled={isSubmitting}
              error={!!errors.packaging}
              options={packagingOptions}
              {...register("packaging")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField
            id="quantityKg"
            label="Quantity (kg)"
            error={errors.quantityKg?.message}
            required
          >
            <FormInput
              id="quantityKg"
              type="number"
              step="any"
              placeholder="e.g., 1000"
              disabled={isSubmitting}
              error={!!errors.quantityKg}
              {...register("quantityKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="value"
            label="Value"
            error={errors.value?.message}
          >
            <FormInput
              id="value"
              type="number"
              step="any"
              placeholder="e.g., 50000"
              disabled={isSubmitting}
              error={!!errors.value}
              {...register("value", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="currency"
            label="Currency"
            error={errors.currency?.message}
          >
            <FormInput
              id="currency"
              type="text"
              placeholder="e.g., TZS"
              disabled={isSubmitting}
              error={!!errors.currency}
              {...register("currency")}
            />
          </FormField>
        </div>
      </FormSection>
      </FormSpine>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
