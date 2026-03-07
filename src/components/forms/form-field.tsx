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
  required?: boolean;
  children: React.ReactNode;
}

export function FormField({
  id,
  label,
  error,
  helperText,
  required,
  children,
}: FormFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="body-small font-medium text-[var(--color-text-secondary)] block mb-6"
      >
        {label}
        {required && (
          <>
            <span className="text-[var(--color-signal-red)] ml-2" aria-hidden="true">*</span>
            <span className="sr-only">Required</span>
          </>
        )}
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
