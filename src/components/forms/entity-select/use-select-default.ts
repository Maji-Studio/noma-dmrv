"use client";

/**
 * A select's own changes to its field, picking a lone option
 * (`autoSelectSingle`) or clearing after a dependency moved, belong to the
 * form's starting state while the operator has edited nothing. They then move
 * the field's default along with its value, so an untouched form stays clean
 * and Cancel closes without "Discard unsaved changes?" (#1360). Once the form
 * is dirty they are edits like any other and leave the defaults alone: they
 * stay in `dirtyFields`, so a patch built from it still sends them, and the
 * field reads as clean again only when its value matches its default again.
 */
import { set, useFormState, type Control, type FieldPath, type FieldValues } from "react-hook-form";

/**
 * Returns the setter for such a change. It applies the value through the
 * field's own `onChange` and reports whether the value became the default.
 */
export function useSelectDefault<TFieldValues extends FieldValues, TContext, TTransformed>(
  control: Control<TFieldValues, TContext, TTransformed>,
) {
  const { isDirty } = useFormState({ control });
  return (name: FieldPath<TFieldValues>, value: unknown, onChange: (value: unknown) => void): boolean => {
    const asDefault = !isDirty;
    // RHF's resetField(name, { defaultValue }) lives on useForm's return, which
    // a field holding only `control` cannot reach (no form here uses
    // FormProvider). This is its effect for one field: move the default, then
    // set the value through onChange, which finds it pristine.
    if (asDefault) set(control._defaultValues, name, value);
    onChange(value);
    return asDefault;
  };
}
