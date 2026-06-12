/**
 * ProductionIncidentForm component
 * Inline form for recording production incidents within a production run
 */
"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatLocalDateTime } from "@/lib/date-utils";
import { FormField, FormInput, FormActions, FormSection } from "@/components/forms";
import { FormTextarea } from "@/components/forms/form-textarea";
import { FormSelect } from "@/components/forms/form-select";
import { EntitySelect } from "@/components/forms/entity-select";
import {
  productionIncidentFormSchema,
  productionIncidentSeverities,
  formatProductionIncidentSeverity,
  type ProductionIncidentFormData,
} from "@/schemas/production-incidents";
import type { ProductionIncidentWithRelations } from "@/data-access/production-incidents";

const severityOptions = productionIncidentSeverities.map((severity) => ({
  value: severity,
  label: formatProductionIncidentSeverity(severity),
}));

interface ProductionIncidentFormProps {
  productionRunId: string;
  facilityId?: string;
  defaultReactorId?: string | null;
  defaultOperatorId?: string | null;
  incident?: ProductionIncidentWithRelations;
  onSubmit: (data: ProductionIncidentFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function ProductionIncidentForm({
  productionRunId,
  facilityId,
  defaultReactorId,
  defaultOperatorId,
  incident,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: ProductionIncidentFormProps) {
  const isEditMode = !!incident;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ProductionIncidentFormData>({
    resolver: zodResolver(productionIncidentFormSchema),
    defaultValues: {
      productionRunId,
      incidentTime: formatLocalDateTime(
        incident?.incidentTime ? new Date(incident.incidentTime) : new Date()
      ),
      operatorId: incident?.operatorId ?? defaultOperatorId ?? "",
      reactorId: incident?.reactorId ?? defaultReactorId ?? "",
      severity: incident?.severity ?? "low",
      description: incident?.description ?? "",
      correctiveActions: incident?.correctiveActions ?? "",
      notes: incident?.notes ?? "",
    },
  });

  const onFormSubmit = handleSubmit((data) => onSubmit(data));

  return (
    <form className="space-y-20" onSubmit={onFormSubmit}>
      <FormSection title="Incident Details" divider={false}>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="incidentTime"
            label="Incident Time"
            error={errors.incidentTime?.message}
            required
          >
            <FormInput
              id="incidentTime"
              type="datetime-local"
              disabled={isSubmitting}
              error={!!errors.incidentTime}
              {...register("incidentTime")}
            />
          </FormField>

          <FormField
            id="severity"
            label="Severity"
            error={errors.severity?.message}
            required
          >
            <FormSelect
              id="severity"
              disabled={isSubmitting}
              error={!!errors.severity}
              options={severityOptions}
              {...register("severity")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="operatorId"
            label="Operator"
            error={errors.operatorId?.message}
          >
            <Controller
              name="operatorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="operator"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="Select operator..."
                  disabled={isSubmitting}
                  error={!!errors.operatorId}
                />
              )}
            />
          </FormField>

          <FormField
            id="reactorId"
            label="Reactor"
            error={errors.reactorId?.message}
          >
            <Controller
              name="reactorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="reactor"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="Select reactor..."
                  disabled={isSubmitting}
                  error={!!errors.reactorId}
                  filterBy={facilityId ? { facilityId } : undefined}
                />
              )}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Summary">

        <FormField
          id="description"
          label="Description"
          error={errors.description?.message}
          required
        >
          <FormTextarea
            id="description"
            rows={4}
            placeholder="What happened during the run?"
            disabled={isSubmitting}
            error={!!errors.description}
            {...register("description")}
          />
        </FormField>

        <FormField
          id="correctiveActions"
          label="Corrective Actions"
          error={errors.correctiveActions?.message}
        >
          <FormTextarea
            id="correctiveActions"
            rows={3}
            placeholder="Actions taken to resolve or contain the incident"
            disabled={isSubmitting}
            error={!!errors.correctiveActions}
            {...register("correctiveActions")}
          />
        </FormField>

        <FormField id="notes" label="Notes" error={errors.notes?.message}>
          <FormTextarea
            id="notes"
            rows={3}
            placeholder="Additional observations"
            disabled={isSubmitting}
            error={!!errors.notes}
            {...register("notes")}
          />
        </FormField>
      </FormSection>

      <FormActions
        sticky={false}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={isEditMode ? "Save Changes" : "Add Incident"}
      />
    </form>
  );
}
