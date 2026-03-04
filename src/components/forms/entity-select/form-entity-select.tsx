/**
 * Form Entity Select
 * Entity select component with React Hook Form integration
 */
"use client";

import { useId } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { FormField } from "../form-field";
import { EntitySelect } from "./entity-select";
import type { EntityType } from "./types";

interface FormEntitySelectProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> {
  /** React Hook Form control object */
  control: Control<TFieldValues>;
  /** Field name in the form */
  name: TName;
  /** Label for the field */
  label: string;
  /** The type of entity to select */
  entityType: EntityType;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text displayed below the field */
  helperText?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether to allow creating new entities inline */
  allowCreate?: boolean;
  /** Label for the quick-add button */
  createLabel?: string;
  /** Callback when quick-add is triggered */
  onCreateNew?: () => void;
  /** Filter options (e.g., facilityId for filtering reactors by facility) */
  filterBy?: Record<string, string>;
  /** Whether the field is required */
  required?: boolean;
}

export function FormEntitySelect<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  control,
  name,
  label,
  entityType,
  placeholder,
  helperText,
  disabled = false,
  allowCreate = false,
  createLabel,
  onCreateNew,
  filterBy,
  required,
}: FormEntitySelectProps<TFieldValues, TName>) {
  const id = useId();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField
          id={id}
          label={label}
          error={fieldState.error?.message}
          helperText={helperText}
          required={required}
        >
          <EntitySelect
            entityType={entityType}
            value={field.value}
            onChange={field.onChange}
            placeholder={placeholder}
            disabled={disabled}
            error={!!fieldState.error}
            allowCreate={allowCreate}
            createLabel={createLabel}
            onCreateNew={onCreateNew}
            filterBy={filterBy}
          />
        </FormField>
      )}
    />
  );
}
