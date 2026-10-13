/**
 * OrderForm component
 * Reusable order form with React Hook Form integration
 */
"use client";

import { formatLocalDate } from "@/lib/date-utils";
import { numericValue } from "@/lib/form-utils";

import { FormActions, FormEntitySelect, FormField, FormInput, FormSection, FormSpine } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import type { Order } from "@/db/schema";
import { useCustomerLocations } from "@/hooks/use-customers";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import {
  orderFormSchema,
  packagingTypes,
  type OrderFormData,
  type PackagingType,
} from "@/schemas/orders";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, PackageIcon, StorefrontIcon } from "@phosphor-icons/react/dist/ssr";
import { useForm, useWatch } from "react-hook-form";

import { CustomerLocationDetails } from "./customer-location-details";
import { MatchingOutputBins } from "./matching-output-bins";

import { useEffect, useState } from "react";
import { CustomerLocationDialog } from "@/components/customers/customer-location-dialog";
import type { EditableCustomerLocation } from "@/components/customers/customer-location-form";

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
  const [editingLocation, setEditingLocation] = useState<{ customerId: string; location: EditableCustomerLocation } | null>(null);
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
      formulationId: order?.formulationId ?? "",
      orderDate: order?.orderDate
        ? formatLocalDate(new Date(order.orderDate))
        : formatLocalDate(new Date()),
      quantityKg: order?.quantityKg ?? undefined,
      packaging:
        (order?.packaging as PackagingType) ?? orgDefaults.defaultPackaging,
    },
  });

  const watchedCustomerId = useWatch({ control, name: "customerId" });
  const selectedCustomerId = watchedCustomerId || undefined;
  const watchedLocationId = useWatch({ control, name: "customerLocationId" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const watchedFormulationId = useWatch({
    control,
    name: "formulationId",
  });

  // Fetch related data for dropdowns. The customer picker fetches its own
  // searchable options through FormEntitySelect, so only locations load here.
  const { data: customerLocationsData } = useCustomerLocations(
    selectedCustomerId ?? "",
    !!selectedCustomerId
  );

  // Get customer locations for selected customer
  const customerLocations = customerLocationsData ?? [];

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

  const defaultSubmitLabel = isEditMode ? "Update order" : "Create order";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as OrderFormData);
  });

  return (
    <>
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
        <div className="grid grid-cols-1 gap-x-16 gap-y-20">
          <FormEntitySelect
            control={control}
            name="customerId"
            label="Customer"
            entityType="customer"
            allowEdit
            placeholder="Select customer..."
            disabled={isSubmitting}
            required
            // Customers are org-shared, so a lone one is not "the" customer for
            // this order. Require an explicit pick, matching the feedstock
            // supplier field (#379).
            autoSelectSingle={false}
          />

          <FormEntitySelect
            id="customerLocationId"
            control={control}
            name="customerLocationId"
            label="Customer location"
            entityType="customerLocation"
            allowEdit={!!selectedLocation && !!selectedCustomerId}
            onEditSelected={selectedLocation && selectedCustomerId
              ? () => setEditingLocation({ customerId: selectedCustomerId, location: selectedLocation })
              : undefined}
            placeholder={selectedCustomerId ? "Select location..." : "Select a customer first"}
            disabled={isSubmitting || !selectedCustomerId}
            filterBy={selectedCustomerId ? { customerId: selectedCustomerId } : undefined}
            dependsOn={watchedCustomerId}
            autoSelectSingle
          />
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
        fields={["formulationId", "quantityKg", "packaging"]}
      >
        <FormEntitySelect control={control} name="formulationId" label="Formulation" entityType="formulation" allowEdit placeholder="Select formulation..." required disabled={isSubmitting} />

        <div className="grid grid-cols-1 gap-x-16 gap-y-20">
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

          <FormField
            id="quantityKg"
            label="Requested wet mass (kg)"
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
        </div>
        {/* Right after the wet mass field, so the operator
            compares the request with what the matching bins hold. */}
        <MatchingOutputBins facilityId={watchedFacilityId || ""} formulationId={watchedFormulationId || ""} />
      </FormSection>
      </FormSpine>

      <FormActions
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
    {editingLocation && (
      <CustomerLocationDialog
        isOpen
        onClose={() => setEditingLocation(null)}
        customerId={editingLocation.customerId}
        location={editingLocation.location}
        facility={formFacility}
      />
    )}
    </>
  );
}
