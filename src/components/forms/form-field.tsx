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
      <label
        htmlFor={id}
        className="body-small font-medium text-[var(--color-text-secondary)] block mb-4"
      >
        {label}
      </label>
      {children}
      {helperText && !error && (
        <p className="body-caption text-[var(--color-text-tertiary)] mt-6">
          {helperText}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
