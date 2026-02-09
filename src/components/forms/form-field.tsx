/**
 * FormField component
 * Wrapper component that provides label, children (input/textarea), and error display
 */

import { FormError } from "./form-error";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  helperText?: string;
  children: React.ReactNode;
}

export function FormField({
  id,
  label,
  error,
  helperText,
  children,
}: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="label-input block mb-8">
        {label}
      </label>
      {children}
      {helperText && !error && (
        <p className="body-small text-[var(--color-text-tertiary)] mt-xs">
          {helperText}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
