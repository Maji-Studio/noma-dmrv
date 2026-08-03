"use client";

import { useEffect, useRef } from "react";
import {
  useFormState,
  useWatch,
  type Control,
  type FieldError,
  type FieldErrors,
  type FieldValues,
  type UseFormTrigger,
} from "react-hook-form";

const ZOD_ERROR_TYPES = new Set([
  "custom",
  "invalid_arguments",
  "invalid_date",
  "invalid_element",
  "invalid_enum_value",
  "invalid_format",
  "invalid_intersection_types",
  "invalid_key",
  "invalid_literal",
  "invalid_return_type",
  "invalid_string",
  "invalid_type",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_value",
  "not_finite",
  "not_multiple_of",
  "too_big",
  "too_small",
  "unrecognized_keys",
]);

function isResolverFieldError(value: unknown): value is FieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    ZOD_ERROR_TYPES.has(value.type)
  );
}

/** Return the RHF paths that currently own errors, including arrays/root errors. */
export function getErrorFieldNames(
  errors: FieldErrors,
  parentPath = "",
): string[] {
  const names: string[] = [];

  for (const [key, value] of Object.entries(errors)) {
    if (value == null) continue;
    const path = parentPath ? `${parentPath}.${key}` : key;

    if (isResolverFieldError(value)) {
      names.push(path);
      continue;
    }

    if (typeof value === "object" && !("type" in value)) {
      names.push(...getErrorFieldNames(value as FieldErrors, path));
    }
  }

  return names;
}

export async function revalidateResolvedErrors<TFieldValues extends FieldValues>(
  errors: FieldErrors<TFieldValues>,
  trigger: UseFormTrigger<TFieldValues>,
): Promise<void> {
  const names = getErrorFieldNames(errors);
  if (names.length === 0) return;

  await trigger(names as Parameters<UseFormTrigger<TFieldValues>>[0], {
    shouldFocus: false,
  });
}

interface ResolvedErrorRevalidatorProps<
  TFieldValues extends FieldValues,
  TContext,
  TTransformedValues extends FieldValues | undefined,
> {
  control: Control<TFieldValues, TContext, TTransformedValues>;
  trigger: UseFormTrigger<TFieldValues>;
}

/**
 * Revalidate only already-visible errors after any form value changes.
 *
 * RHF normally merges resolver results for the changed field only. A related
 * field can therefore resolve a cross-field Zod issue while the old error
 * remains attached elsewhere. Keeping this subscription in a null-rendering
 * child isolates its per-value renders from the parent form.
 */
export function ResolvedErrorRevalidator<
  TFieldValues extends FieldValues,
  TContext,
  TTransformedValues extends FieldValues | undefined,
>({
  control,
  trigger,
}: ResolvedErrorRevalidatorProps<
  TFieldValues,
  TContext,
  TTransformedValues
>) {
  const values = useWatch({ control });
  const { errors } = useFormState({ control });
  const previousValues = useRef(values);

  useEffect(() => {
    if (previousValues.current === values) return;
    previousValues.current = values;
    void revalidateResolvedErrors(errors, trigger);
  }, [errors, trigger, values]);

  return null;
}
