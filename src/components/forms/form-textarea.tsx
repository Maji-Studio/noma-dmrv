/**
 * FormTextarea component
 * Styled textarea component with design system classes
 * Integrates with React Hook Form via register spread
 */

import { forwardRef } from "react";

interface FormTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`w-full px-m py-s border border-[var(--color-border-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--clr-dark-purple)] min-h-[100px] ${className || ""}`}
        aria-invalid={error ? "true" : "false"}
        {...props}
      />
    );
  }
);

FormTextarea.displayName = "FormTextarea";
