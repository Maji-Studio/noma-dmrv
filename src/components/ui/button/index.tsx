import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap label-button transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer rounded-none",
  {
    variants: {
      variant: {
        default: "border border-[var(--color-border-primary)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-medium)] active:bg-[var(--color-surface-light)]",
        weak: "border border-[var(--color-border-tertiary)] bg-transparent text-[var(--color-text-primary)] hover:border-[var(--color-border-primary)] hover:bg-[var(--color-surface-medium)]",
        primary: "bg-[var(--color-interaction)] text-white hover:bg-[var(--color-interaction-hover)] active:bg-[var(--color-interaction-active)] border-transparent",
        accent: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)] border-transparent",
        noOutline: "border-transparent bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-medium)]",
      },
      size: {
        default: "h-[48px] px-[var(--spacing-16)] xl:h-[60px] xl:px-[var(--spacing-24)] gap-[var(--spacing-12)]",
        small: "h-[32px] px-[var(--spacing-12)] gap-[var(--spacing-8)] text-[var(--text-xs)]",
      },
      width: {
        default: "w-auto",
        square: "aspect-square p-0",
        full: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      width: "default",
    },
  }
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, width, type = "button", ...props }, ref) => {
    return (
      <button
        type={type}
        className={cn(buttonVariants({ variant, size, width, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
