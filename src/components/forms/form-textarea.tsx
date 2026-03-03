/**
 * FormTextarea component
 * Styled textarea component with design system classes
 * Integrates with React Hook Form via register spread
 */

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full px-12 py-12 border border-[var(--color-border-secondary)] rounded-none bg-[var(--color-background-white)] text-[var(--color-text-primary)] text-[var(--text-s)] transition-all min-h-[100px] placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed disabled:opacity-50",
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
          "focus:outline-none focus:border-[var(--color-interaction)] focus:ring-1 focus:ring-[var(--color-interaction)]",
          error && "border-[var(--color-signal-red)]",
          className
        )}
        aria-invalid={error ? "true" : "false"}
        {...props}
      />
    );
  }
);

FormTextarea.displayName = "FormTextarea";
