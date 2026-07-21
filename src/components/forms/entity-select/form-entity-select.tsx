/**
 * Form Entity Select
 * Entity select component with React Hook Form integration
 */
"use client";

import { useId } from "react";
import { useController, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { FormField } from "../form-field";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";
import { EntitySelect } from "./entity-select";
import type { EntitySelectProps, EntityType } from "./types";

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
  /** Auto-select when there is exactly one option (defaults to true when required) */
  autoSelectSingle?: boolean;
  /** Always show the search input while dropdown is open */
  alwaysShowSearch?: boolean;
  /** Hide the search input entirely */
  hideSearch?: boolean;
  /**
   * Dependency value(s) for cascading selects.
   * When any value changes, the selected value is cleared automatically.
   * Accepts a single value or an array for multi-dependency cascades.
   *
   * @example
   * // Single dependency: bin clears when feedstock type changes
   * <FormEntitySelect dependsOn={watchedFeedstockTypeId} ... />
   *
   * // Multiple dependencies: bin clears when feedstock type OR facility changes
   * <FormEntitySelect dependsOn={[watchedFeedstockTypeId, watchedFacilityId]} ... />
   */
  dependsOn?: string | null | (string | null | undefined)[];
  /** Empty-list hint naming the upstream prerequisite (see EntitySelectProps). */
  emptyHint?: EntitySelectProps["emptyHint"];
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
  autoSelectSingle,
  alwaysShowSearch = false,
  hideSearch = false,
  dependsOn,
  emptyHint,
}: FormEntitySelectProps<TFieldValues, TName>) {
  const id = useId();
  const { field, fieldState } = useController({ control, name });

  useClearOnDependencyChange(dependsOn, field.onChange);

  return (
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
        autoSelectSingle={autoSelectSingle ?? required}
        alwaysShowSearch={alwaysShowSearch}
        hideSearch={hideSearch}
        emptyHint={emptyHint}
      />
    </FormField>
  );
}
