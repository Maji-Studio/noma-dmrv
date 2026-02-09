/**
 * FormInput component
 * Styled input component with design system classes
 * Integrates with React Hook Form via register spread
 */

import { forwardRef } from "react";
import { Input } from "@/components/ui";

interface FormInputProps extends React.ComponentPropsWithoutRef<typeof Input> {
  error?: boolean;
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        className={className}
        aria-invalid={error ? "true" : "false"}
        {...props}
      />
    );
  }
);

FormInput.displayName = "FormInput";
